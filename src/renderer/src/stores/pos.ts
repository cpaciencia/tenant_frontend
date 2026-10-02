import { computed, ref } from 'vue'
import { findInvoice } from '../services/invoices'
import { defineStore } from 'pinia'
import { eur } from '../data/catalog'
import { useClientsStore } from './clients'
import { useCatalogStore } from './catalog'
import { useAuthStore } from './auth'
import type {
  ParkedTicket,
  CashSession,
  CloseSessionResult,
  CreateSaleRequest,
  ManualItemInput,
  OpenSessionRequest,
  RendererAuditType,
  Sale
} from '../../../shared/types'

export type PayMethod = 'efectivo' | 'tarjeta' | 'mixto' | 'fiado' | 'interno'

export interface TicketLine {
  key: string
  /** Product id, used to merge repeated scans (a unique key for manual lines). */
  id: string
  name: string
  price: number
  qty: number
  /** Rung by price without a catalog product ("Producto" (no barcode) / barcode not found). */
  manual?: ManualItemInput
}

/** A scanned barcode that isn't in the catalog: the manual-entry dialog is open for it. */
export interface ManualEntryRequest {
  barcode: string
}

export interface SessionUser {
  name: string
  role: string
}

/** IVA included in the sample prices. */
const TAX_RATE = 0.21

/**
 * Central POS state, ported from the prototype's logic class. Holds the session
 * user, the active sale ticket, the numpad buffer, search text and the full
 * payment flow. Backed entirely by in-memory sample data for now (see
 * data/catalog.ts) — the real sale would go through the IPC bridge to
 * createSale() in the Main process.
 */
export const usePosStore = defineStore('pos', () => {
  // Session
  const user = ref<SessionUser | null>(null)

  // The terminal's open caja (it belongs to the shift, not to a cashier). Everyone
  // on duty sells into it with their own user. No open caja → no selling.
  const currentSession = ref<CashSession | null>(null)
  const hasSession = computed(() => currentSession.value !== null)
  /** A cierre left this caja open for the next shift and nobody has accepted it yet. */
  const awaitingResponsible = computed(
    () => currentSession.value !== null && !currentSession.value.responsibleName
  )

  /** The logged-in user, as recorded on sales, acceptances and cierres. */
  function actor(): { userId: string | null; name: string } {
    const auth = useAuthStore()
    return {
      userId: auth.user?.id ?? null,
      name: user.value?.name || auth.user?.fullName || auth.user?.username || 'Desconocido'
    }
  }

  /** Load the terminal's open caja (the one left by the last cierre, or none). */
  async function loadSession(): Promise<void> {
    try {
      currentSession.value = await window.api.cashSession.current()
    } catch {
      currentSession.value = null
    }
  }

  /** Open the terminal's caja by hand (first run): the opener is its responsible. */
  async function openCaja(
    req: Pick<OpenSessionRequest, 'openingFloatCents' | 'shiftId'>
  ): Promise<void> {
    const me = actor()
    currentSession.value = await window.api.cashSession.open({
      ...req,
      cashierUserId: me.userId,
      cashierName: me.name
    })
  }

  /**
   * The logged-in user takes responsibility for the caja left by the previous
   * cierre, optionally correcting the float they counted in the drawer.
   */
  async function acceptCaja(openingFloatCents?: number): Promise<void> {
    const sessionId = currentSession.value?.id
    if (!sessionId) throw new Error('No hay caja abierta')
    const me = actor()
    currentSession.value = await window.api.cashSession.accept({
      sessionId,
      userId: me.userId,
      userName: me.name,
      openingFloatCents: openingFloatCents ?? null
    })
  }

  /** Seal the current caja (arqueo); the next shift's caja becomes the current one. */
  async function closeCaja(input: {
    countedCashCents: number
    closingFloatCents: number
    cashOutCents?: number
  }): Promise<CloseSessionResult> {
    const sessionId = currentSession.value?.id
    if (!sessionId) throw new Error('No hay caja abierta')
    const me = actor()
    const result = await window.api.cashSession.close({
      sessionId,
      ...input,
      closedByUserId: me.userId,
      closedByName: me.name
    })
    currentSession.value = result.next
    return result
  }

  // Catalog browsing. Empty until the grid selects the first real category.
  const activeCat = ref('')
  const search = ref('')
  /** Pending quantity typed on the numpad (max 3 digits), applied to next add. */
  const buffer = ref('')

  // Ticket
  const ticket = ref<TicketLine[]>([])
  const selectedKey = ref<string | null>(null)

  // Payment
  const payOpen = ref(false)
  const payMethod = ref<PayMethod>('efectivo')
  const cashGiven = ref(0)
  /** For mixed payment: how much of the total is paid in cash (euros); rest on card. */
  const mixedCashEur = ref(0)
  const fiadoClient = ref<string | null>(null)
  /** Internal consumption: account, who takes the goods (mandatory) and why. */
  const internalAccountId = ref<string | null>(null)
  const internalTakenBy = ref('')
  const internalReason = ref('')
  /** Who-took-it list (staff) and accounts, loaded when the payment opens. */
  const internalAccounts = ref<{ id: string; name: string }[]>([])
  const staffNames = ref<string[]>([])
  /** Only catalog products can go as internal consumption. */
  const internalAllowed = computed(() => !ticket.value.some((l) => l.manual))
  /** Last internal consumption number (shown instead of a ticket number). */
  const lastConsumptionNumber = ref('')
  /** A client's debt collected together with this purchase (optional). */
  const settleClientId = ref<string | null>(null)
  const settleEur = ref<number | null>(null)
  const payDone = ref(false)
  const payResultLabel = ref('')
  const payChange = ref(0)
  /** True while the sale is being persisted over IPC. */
  const paying = ref(false)
  const payError = ref('')
  /** Ticket number issued by the Main process for the last completed sale. */
  const lastTicketNumber = ref('')
  /** The full last sale (for the printable receipt). */
  const lastSale = ref<Sale | null>(null)

  // --- Derived ---
  const lineCount = computed(() => ticket.value.reduce((a, l) => a + l.qty, 0))
  const isEmpty = computed(() => ticket.value.length === 0)
  const total = computed(() => ticket.value.reduce((a, l) => a + l.price * l.qty, 0))
  const base = computed(() => total.value / (1 + TAX_RATE))
  const iva = computed(() => total.value - base.value)
  const hasBuffer = computed(() => buffer.value !== '')

  /**
   * The ticket being built has an identity (`draftId`) shared by every event about
   * it — lines added/removed, payment opened/cancelled, parked, paid or emptied —
   * so the Backoffice can replay its whole story. Plus a few facts kept to tell,
   * when it is emptied, whether the payment screen had been opened and how much
   * cash was typed (the "charged, pocketed the money and deleted it" pattern).
   */
  const draftId = ref<string | null>(null)
  const draft = {
    startedAt: 0,
    linesAdded: 0,
    linesRemoved: 0,
    paymentOpened: false,
    maxTenderedCents: 0,
    payOpenedAt: 0
  }

  function ensureDraft(): void {
    if (draftId.value) return
    draftId.value = crypto.randomUUID()
    Object.assign(draft, {
      startedAt: Date.now(),
      linesAdded: 0,
      linesRemoved: 0,
      paymentOpened: false,
      maxTenderedCents: 0,
      payOpenedAt: 0
    })
  }

  function resetDraft(): void {
    draftId.value = null
  }

  /**
   * Record a UI action in the audit log, tagged with the current ticket's draftId.
   * Fire-and-forget: logging must never block or break the sale.
   */
  function logEvent(type: RendererAuditType, data: Record<string, unknown> = {}): void {
    const payload = draftId.value ? { draftId: draftId.value, ...data } : data
    window.api.audit.record({ type, actor: actor(), data: payload }).catch(() => {})
  }

  // Lines sold without a catalog product still waiting to be completed (badge).
  const pendingCount = ref(0)
  async function refreshPendingCount(): Promise<void> {
    try {
      pendingCount.value = (await window.api.pendingItems.list()).length
    } catch {
      pendingCount.value = 0
    }
  }

  /** Supplier payments of the open caja whose invoice isn't on the server yet. */
  const invoicesPending = ref(0)
  async function refreshInvoicesPending(): Promise<void> {
    try {
      invoicesPending.value = (await window.api.cashMovements.current()).invoicesPending
    } catch {
      invoicesPending.value = 0
    }
  }

  /**
   * Pick up invoices that reached the server another way (a phone via QR while the
   * till was elsewhere, or an upload the till couldn't record): mark them uploaded.
   * Silent and best-effort (offline / no online session: they stay pending).
   */
  async function reconcileInvoices(): Promise<void> {
    try {
      const pending = (await window.api.cashMovements.current()).list.filter(
        (m) => m.invoiceStatus === 'pending'
      )
      for (const m of pending) {
        const inv = await findInvoice(m.id)
        if (inv) {
          await window.api.cashMovements.markInvoiceUploaded({
            cashMovementId: m.id,
            fileName: inv.fileName,
            via: inv.uploadedVia,
            actor: actor()
          })
        }
      }
    } catch {
      // offline or no server session
    }
    await refreshInvoicesPending()
  }

  // Manual entry dialog for a scanned barcode that isn't in the catalog.
  const manualEntry = ref<ManualEntryRequest | null>(null)
  function openManualEntry(barcode: string): void {
    manualEntry.value = { barcode }
  }

  /**
   * Add a line rung by price only; it never merges with other lines. The quantity
   * comes from the keypad unless given.
   */
  function addManualLine(
    name: string,
    price: number,
    manual: ManualItemInput,
    quantity?: number
  ): void {
    const qty = quantity ?? keypadQuantity()
    const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ensureDraft()
    draft.linesAdded += 1
    ticket.value.push({ key, id: key, name, price, qty, manual })
    selectedKey.value = key
    buffer.value = ''
    logEvent('product.manual_added', {
      kind: manual.kind,
      barcode: manual.barcode,
      name: manual.name,
      priceCents: Math.round(price * 100),
      quantity: qty
    })
  }

  // --- Ticket actions ---
  /** Units typed on the keypad for the next line (1 when nothing typed). */
  function keypadQuantity(): number {
    return Math.max(1, parseInt(buffer.value, 10) || 1)
  }

  /** How a product got into the ticket (for the audit trail). */
  type AddSource = 'tap' | 'scan' | 'search'

  function addProduct(id: string, name: string, price: number, source: AddSource = 'tap'): void {
    const qty = keypadQuantity()
    ensureDraft()
    draft.linesAdded += 1
    logEvent('ticket.line_added', {
      source,
      productId: id,
      name,
      quantity: qty,
      priceCents: Math.round(price * 100)
    })
    const existing = ticket.value.find((l) => l.id === id)
    if (existing) {
      existing.qty += qty
      selectedKey.value = existing.key
    } else {
      const key = `${id}-${Date.now()}`
      ticket.value.push({ key, id, name, price, qty })
      selectedKey.value = key
    }
    buffer.value = ''
  }

  function changeQty(key: string, delta: number): void {
    const line = ticket.value.find((l) => l.key === key)
    if (line && delta < 0) {
      draft.linesRemoved += 1
      logEvent(line.qty + delta <= 0 ? 'ticket.line_removed' : 'ticket.qty_decreased', {
        ...lineData(line),
        by: -delta
      })
    }
    ticket.value = ticket.value
      .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0)
    if (!ticket.value.some((l) => l.key === selectedKey.value)) selectedKey.value = null
  }

  function selectLine(key: string): void {
    selectedKey.value = key
  }

  /** Factual summary of a ticket line for the audit log. */
  function lineData(line: TicketLine): Record<string, unknown> {
    return {
      productId: line.manual ? null : line.id,
      name: line.name,
      quantity: line.qty,
      priceCents: Math.round(line.price * 100),
      manual: Boolean(line.manual)
    }
  }

  function removeLine(key: string): void {
    const line = ticket.value.find((l) => l.key === key)
    if (line) {
      draft.linesRemoved += 1
      logEvent('ticket.line_removed', {
        ...lineData(line),
        afterPaymentOpened: draft.paymentOpened
      })
    }
    ticket.value = ticket.value.filter((l) => l.key !== key)
    if (selectedKey.value === key) selectedKey.value = null
  }

  function clearTicket(): void {
    ticket.value = []
    selectedKey.value = null
    buffer.value = ''
    resetDraft()
  }

  /**
   * Throw away an unpaid ticket (the "Vaciar" button, logout…) — audited with
   * everything known about it, notably whether the payment screen had been opened
   * and how much cash was typed in it.
   */
  function voidTicket(reason: 'manual' | 'logout' = 'manual'): void {
    if (ticket.value.length) {
      logEvent('ticket.cleared', {
        reason,
        lines: ticket.value.length,
        totalCents: Math.round(total.value * 100),
        items: ticket.value.map(lineData),
        paymentOpened: draft.paymentOpened,
        maxTenderedCents: draft.maxTenderedCents,
        secondsOpen: draft.startedAt ? Math.round((Date.now() - draft.startedAt) / 1000) : null,
        linesAdded: draft.linesAdded,
        linesRemoved: draft.linesRemoved
      })
    }
    clearTicket()
  }

  // --- Parked tickets (set aside unpaid to serve someone else) ---
  const parkedCount = ref(0)
  async function refreshParked(): Promise<ParkedTicket[]> {
    try {
      const list = await window.api.parked.list()
      parkedCount.value = list.length
      return list
    } catch {
      parkedCount.value = 0
      return []
    }
  }

  /** Plain copy of the ticket lines (reactive proxies can't cross the IPC bridge). */
  function plainLines(): TicketLine[] {
    return ticket.value.map((l) => ({ ...l, ...(l.manual ? { manual: { ...l.manual } } : {}) }))
  }

  /** Set the current ticket aside; the till is free for the next customer. */
  async function parkCurrent(): Promise<void> {
    if (isEmpty.value) return
    await window.api.parked.park({ draftId: draftId.value, lines: plainLines(), actor: actor() })
    clearTicket()
    await refreshParked()
  }

  /** Bring a parked ticket back (the current one, if any, is parked first). */
  async function resumeParked(id: string): Promise<void> {
    if (!isEmpty.value) await parkCurrent()
    const parked = await window.api.parked.resume({ id, actor: actor() })
    ticket.value = parked.lines.map((l) => ({ ...l }))
    selectedKey.value = null
    // Keep the ticket's identity so its story continues where it was left.
    draftId.value = parked.draftId ?? crypto.randomUUID()
    Object.assign(draft, {
      startedAt: Date.now(),
      linesAdded: 0,
      linesRemoved: 0,
      paymentOpened: false,
      maxTenderedCents: 0,
      payOpenedAt: 0
    })
    await refreshParked()
  }

  async function discardParked(id: string): Promise<void> {
    await window.api.parked.discard({ id, actor: actor() })
    await refreshParked()
  }

  // --- Numpad ---
  function keyTap(label: string): void {
    if (label === 'C') {
      buffer.value = ''
      return
    }
    if (label === '⌫') {
      buffer.value = buffer.value.slice(0, -1)
      return
    }
    buffer.value = (buffer.value + label).slice(0, 3)
  }

  // "Producto" (no barcode): sell something without a barcode by typing its price.
  const freePriceOpen = ref(false)

  /**
   * Add a "precio libre" line in a category (its accounting group); it becomes a
   * pending item once paid, to be identified later.
   */
  function addFreePriceLine(
    priceEur: number,
    categoryId: string | null,
    label: string,
    quantity: number
  ): void {
    addManualLine(
      label,
      priceEur,
      { kind: 'quick', barcode: null, name: null, categoryId },
      quantity
    )
  }

  function clearBuffer(): void {
    buffer.value = ''
  }

  // --- Payment flow ---
  function openPay(): void {
    if (isEmpty.value) return
    ensureDraft()
    draft.paymentOpened = true
    draft.payOpenedAt = Date.now()
    logEvent('payment.opened', {
      totalCents: Math.round(total.value * 100),
      lines: ticket.value.length
    })
    payOpen.value = true
    payMethod.value = 'efectivo'
    cashGiven.value = 0
    mixedCashEur.value = 0
    fiadoClient.value = null
    settleClientId.value = null
    settleEur.value = null
    internalAccountId.value = null
    internalTakenBy.value = ''
    internalReason.value = ''
    lastConsumptionNumber.value = ''
    payDone.value = false
    payError.value = ''
    void useClientsStore().load()
    void loadInternalLists()
  }

  async function loadInternalLists(): Promise<void> {
    try {
      ;[internalAccounts.value, staffNames.value] = await Promise.all([
        window.api.internal.accounts(),
        window.api.internal.staff()
      ])
    } catch {
      internalAccounts.value = []
      staffNames.value = []
    }
  }

  function closePay(): void {
    if (!payDone.value) {
      const tenderedCents = Math.round((cashGiven.value || 0) * 100)
      draft.maxTenderedCents = Math.max(draft.maxTenderedCents, tenderedCents)
      logEvent('payment.cancelled', {
        method: payMethod.value,
        totalCents: Math.round(total.value * 100),
        lines: ticket.value.length,
        tenderedCents,
        secondsOpen: draft.payOpenedAt ? Math.round((Date.now() - draft.payOpenedAt) / 1000) : null
      })
    }
    payOpen.value = false
  }

  /** Negative total = a refund (e.g. handing back a deposit/"fianza"). */
  const isRefund = computed(() => total.value < 0)

  /** Debt collected with this purchase (euros): never on a credit sale or a refund. */
  const settleAmount = computed(() =>
    settleClientId.value && !isRefund.value && payMethod.value !== 'fiado'
      ? Math.max(0, settleEur.value ?? 0)
      : 0
  )
  const settleClient = computed(() => useClientsStore().get(settleClientId.value))
  const settleValid = computed(
    () =>
      !settleClientId.value ||
      payMethod.value === 'fiado' ||
      (settleAmount.value > 0 &&
        Math.round(settleAmount.value * 100) <= (settleClient.value?.balanceCents ?? 0))
  )
  /** What the customer pays now: the ticket plus any debt collected with it. */
  const dueTotal = computed(() => Math.round((total.value + settleAmount.value) * 100) / 100)

  /** Quick cash amount; a negative value means "exact" (matches what is due). */
  function pickCash(value: number): void {
    cashGiven.value = value < 0 ? dueTotal.value : value
  }

  const cashOk = computed(() => cashGiven.value >= dueTotal.value && dueTotal.value > 0)
  const change = computed(() => Math.max(0, cashGiven.value - dueTotal.value))

  const confirmEnabled = computed(() => {
    if (total.value === 0) return false
    if (!settleValid.value) return false
    // Refund: pay it straight back in cash or card (no change calculation needed).
    if (isRefund.value) return payMethod.value === 'efectivo' || payMethod.value === 'tarjeta'
    if (payMethod.value === 'efectivo') return cashOk.value
    if (payMethod.value === 'fiado') return !!fiadoClient.value
    if (payMethod.value === 'interno')
      return internalAllowed.value && !!internalAccountId.value && !!internalTakenBy.value.trim()
    if (payMethod.value === 'mixto')
      return mixedCashEur.value >= 0 && mixedCashEur.value <= dueTotal.value
    return true
  })

  /**
   * Persists the sale through the IPC bridge (createSale in the Main process),
   * then shows the result. Each line carries its accounting-group snapshot (caja)
   * resolved from the catalog, so the Z-report can break the takings down later.
   */
  /** Split the total (cents) into cash/card/credit for the chosen method. */
  function buildPayment(totalCents: number): CreateSaleRequest['payment'] {
    const none = { clientId: null, clientName: null }
    if (payMethod.value === 'efectivo') {
      return { cashCents: totalCents, cardCents: 0, creditCents: 0, ...none }
    }
    if (payMethod.value === 'tarjeta') {
      return { cashCents: 0, cardCents: totalCents, creditCents: 0, ...none }
    }
    if (payMethod.value === 'mixto') {
      const cash = Math.min(Math.max(0, Math.round(mixedCashEur.value * 100)), totalCents)
      return { cashCents: cash, cardCents: totalCents - cash, creditCents: 0, ...none }
    }
    // A cuenta: the whole total goes on the client's account (Main names it).
    const client = useClientsStore().get(fiadoClient.value)
    return {
      cashCents: 0,
      cardCents: 0,
      creditCents: totalCents,
      clientId: fiadoClient.value,
      clientName: client?.name ?? null
    }
  }

  /**
   * Split of the sale and the debt collected with it. Cash/card: all of it that
   * way. Mixed: the cash typed covers the ticket first, the rest of it the debt;
   * the card covers whatever remains.
   */
  function buildSplit(totalCents: number): {
    payment: CreateSaleRequest['payment']
    settlement: CreateSaleRequest['settlement']
  } {
    const settleCents = Math.round(settleAmount.value * 100)
    if (settleCents <= 0 || !settleClientId.value) {
      return { payment: buildPayment(totalCents), settlement: null }
    }
    const none = { clientId: null, clientName: null }
    const clientId = settleClientId.value
    if (payMethod.value === 'tarjeta') {
      return {
        payment: { cashCents: 0, cardCents: totalCents, creditCents: 0, ...none },
        settlement: { clientId, cashCents: 0, cardCents: settleCents }
      }
    }
    if (payMethod.value === 'mixto') {
      const cash = Math.min(
        Math.max(0, Math.round(mixedCashEur.value * 100)),
        totalCents + settleCents
      )
      const saleCash = Math.min(cash, totalCents)
      const settleCash = cash - saleCash
      return {
        payment: { cashCents: saleCash, cardCents: totalCents - saleCash, creditCents: 0, ...none },
        settlement: { clientId, cashCents: settleCash, cardCents: settleCents - settleCash }
      }
    }
    return {
      payment: { cashCents: totalCents, cardCents: 0, creditCents: 0, ...none },
      settlement: { clientId, cashCents: settleCents, cardCents: 0 }
    }
  }

  async function confirmPay(): Promise<void> {
    if (!confirmEnabled.value || paying.value) return
    if (!currentSession.value) {
      payError.value = 'No hay una caja abierta.'
      return
    }
    if (payMethod.value === 'interno') {
      await confirmInternal()
      return
    }
    const t = total.value
    const totalCents = Math.round(t * 100)
    const catalog = useCatalogStore()
    const request: CreateSaleRequest = {
      items: ticket.value.map((l) =>
        l.manual
          ? {
              productId: null,
              name: l.name,
              quantity: l.qty,
              unitPriceCents: Math.round(l.price * 100),
              accountingGroupId: catalog.accountingGroupIdForCategory(
                l.manual.categoryId ?? catalog.quickSaleCategory()?.id ?? null
              ),
              // Plain copy: a reactive proxy can't cross the IPC bridge.
              manual: { ...l.manual }
            }
          : {
              productId: l.id,
              name: l.name,
              quantity: l.qty,
              unitPriceCents: Math.round(l.price * 100),
              accountingGroupId: catalog.accountingGroupIdFor(l.id)
            }
      ),
      ...buildSplit(totalCents),
      cashSessionId: currentSession.value.id,
      draftId: draftId.value,
      sellerUserId: actor().userId,
      sellerName: actor().name
    }

    paying.value = true
    payError.value = ''
    try {
      const sale = await window.api.sales.create(request)
      lastTicketNumber.value = sale.ticketNumber
      lastSale.value = sale
      // Best sellers first: the order follows every sale.
      void catalog.refreshRanking()
      // Manual lines became pending items: update the blinking badge.
      if (ticket.value.some((l) => l.manual)) void refreshPendingCount()
      // Balances changed (credit sale or debt collected).
      if (sale.payment.creditCents !== 0 || sale.settlement) void useClientsStore().load()
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : ''
      payError.value = msg || 'No se pudo registrar la venta. Inténtalo de nuevo.'
      return
    } finally {
      paying.value = false
    }

    const due = dueTotal.value
    if (payMethod.value === 'efectivo') {
      if (isRefund.value) {
        payChange.value = 0
        payResultLabel.value = `Devolución en efectivo · ${eur(-t)}`
      } else {
        payChange.value = cashGiven.value - due
        payResultLabel.value = `Pago en efectivo · ${eur(due)}`
      }
    } else if (payMethod.value === 'tarjeta') {
      payChange.value = 0
      payResultLabel.value = isRefund.value
        ? `Devolución a tarjeta · ${eur(-t)}`
        : `Pago con tarjeta · ${eur(due)}`
    } else if (payMethod.value === 'mixto') {
      payChange.value = 0
      const cash = Math.min(Math.max(0, mixedCashEur.value), due)
      payResultLabel.value = `Mixto · ${eur(cash)} efectivo + ${eur(due - cash)} tarjeta`
    } else {
      payChange.value = 0
      payResultLabel.value = `Anotado a la cuenta de ${lastSale.value?.payment.clientName ?? ''}`
    }
    const settled = lastSale.value?.settlement
    if (settled) {
      payResultLabel.value += ` · incluye ${eur(settled.totalCents / 100)} de la cuenta de ${settled.clientName} (${settled.paymentNumber})`
    }
    payDone.value = true
  }

  /**
   * The open ticket leaves as internal consumption (not a sale): no money, own
   * numbering, who takes it recorded. Then the ticket is cleared like a sale.
   */
  async function confirmInternal(): Promise<void> {
    paying.value = true
    payError.value = ''
    try {
      const record = await window.api.internal.record({
        items: ticket.value.map((l) => ({
          productId: l.id,
          name: l.name,
          quantity: l.qty,
          unitPriceCents: Math.round(l.price * 100)
        })),
        accountId: internalAccountId.value!,
        takenByName: internalTakenBy.value.trim(),
        reason: internalReason.value.trim() || null,
        cashSessionId: currentSession.value!.id,
        draftId: draftId.value,
        actor: actor()
      })
      lastConsumptionNumber.value = record.consumptionNumber
      lastTicketNumber.value = record.consumptionNumber
      lastSale.value = null
      payChange.value = 0
      payResultLabel.value = `Consumo interno · ${record.accountName} · se lo lleva ${record.takenByName} (no es venta)`
      payDone.value = true
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : ''
      payError.value = msg || 'No se pudo registrar el consumo interno.'
    } finally {
      paying.value = false
    }
  }

  /** Clears everything and closes the modal, ready for the next sale. */
  function newTicket(): void {
    clearTicket()
    payOpen.value = false
    payDone.value = false
    cashGiven.value = 0
    fiadoClient.value = null
    settleClientId.value = null
    settleEur.value = null
    payError.value = ''
    lastTicketNumber.value = ''
  }

  // --- Session ---
  function login(sessionUser: SessionUser): void {
    user.value = sessionUser
  }

  function logout(): void {
    logEvent('auth.logout')
    voidTicket('logout')
    user.value = null
    // The caja itself stays OPEN in the DB — it belongs to the shift, and the next
    // user's login reloads it via loadSession().
    currentSession.value = null
  }

  return {
    user,
    currentSession,
    hasSession,
    awaitingResponsible,
    actor,
    loadSession,
    openCaja,
    acceptCaja,
    closeCaja,
    activeCat,
    search,
    buffer,
    ticket,
    selectedKey,
    payOpen,
    payMethod,
    cashGiven,
    mixedCashEur,
    fiadoClient,
    settleClientId,
    settleEur,
    internalAccountId,
    internalTakenBy,
    internalReason,
    internalAccounts,
    staffNames,
    internalAllowed,
    lastConsumptionNumber,
    settleAmount,
    settleValid,
    dueTotal,
    payDone,
    payResultLabel,
    payChange,
    paying,
    payError,
    lastTicketNumber,
    lastSale,
    lineCount,
    isEmpty,
    total,
    base,
    iva,
    hasBuffer,
    cashOk,
    change,
    isRefund,
    confirmEnabled,
    addProduct,
    addManualLine,
    manualEntry,
    openManualEntry,
    freePriceOpen,
    addFreePriceLine,
    pendingCount,
    invoicesPending,
    refreshInvoicesPending,
    reconcileInvoices,
    refreshPendingCount,
    logEvent,
    voidTicket,
    parkedCount,
    refreshParked,
    parkCurrent,
    resumeParked,
    discardParked,
    changeQty,
    selectLine,
    removeLine,
    clearTicket,
    keyTap,
    clearBuffer,
    openPay,
    closePay,
    pickCash,
    confirmPay,
    newTicket,
    login,
    logout
  }
})
