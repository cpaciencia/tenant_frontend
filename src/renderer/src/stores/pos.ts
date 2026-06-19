import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { clients, eur } from '../data/catalog'
import { useCatalogStore } from './catalog'
import type { CreateSaleRequest, Sale } from '../../../shared/types'

export type PayMethod = 'efectivo' | 'tarjeta' | 'mixto' | 'fiado'

export interface TicketLine {
  key: string
  /** Stable product key (`category-name`) used to merge repeated scans. */
  id: string
  name: string
  price: number
  qty: number
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

  // --- Ticket actions ---
  function addProduct(id: string, name: string, price: number): void {
    const qty = Math.max(1, parseInt(buffer.value, 10) || 1)
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
    ticket.value = ticket.value
      .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0)
    if (!ticket.value.some((l) => l.key === selectedKey.value)) selectedKey.value = null
  }

  function selectLine(key: string): void {
    selectedKey.value = key
  }

  function removeLine(key: string): void {
    ticket.value = ticket.value.filter((l) => l.key !== key)
    if (selectedKey.value === key) selectedKey.value = null
  }

  function clearTicket(): void {
    ticket.value = []
    selectedKey.value = null
    buffer.value = ''
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

  function clearBuffer(): void {
    buffer.value = ''
  }

  // --- Payment flow ---
  function openPay(): void {
    if (isEmpty.value) return
    payOpen.value = true
    payMethod.value = 'efectivo'
    cashGiven.value = 0
    mixedCashEur.value = 0
    fiadoClient.value = null
    payDone.value = false
    payError.value = ''
  }

  function closePay(): void {
    payOpen.value = false
  }

  /** Quick cash amount; a negative value means "exact" (matches the total). */
  function pickCash(value: number): void {
    cashGiven.value = value < 0 ? total.value : value
  }

  const cashOk = computed(() => cashGiven.value >= total.value && total.value > 0)
  const change = computed(() => Math.max(0, cashGiven.value - total.value))

  const confirmEnabled = computed(() => {
    if (total.value <= 0) return false
    if (payMethod.value === 'efectivo') return cashOk.value
    if (payMethod.value === 'fiado') return !!fiadoClient.value
    if (payMethod.value === 'mixto') return mixedCashEur.value >= 0 && mixedCashEur.value <= total.value
    return true
  })

  /**
   * Persists the sale through the IPC bridge (createSale in the Main process),
   * then shows the result. Each line carries its accounting-group snapshot (caja)
   * resolved from the catalog, so the Z-report can break the takings down later.
   */
  /** Split the total (cents) into cash/card/credit for the chosen method. */
  function buildPayment(totalCents: number): CreateSaleRequest['payment'] {
    if (payMethod.value === 'efectivo') {
      return { cashCents: totalCents, cardCents: 0, creditCents: 0, clientId: null }
    }
    if (payMethod.value === 'tarjeta') {
      return { cashCents: 0, cardCents: totalCents, creditCents: 0, clientId: null }
    }
    if (payMethod.value === 'mixto') {
      const cash = Math.min(Math.max(0, Math.round(mixedCashEur.value * 100)), totalCents)
      return { cashCents: cash, cardCents: totalCents - cash, creditCents: 0, clientId: null }
    }
    // fiado: the whole total is left on account (real client comes in H3).
    return { cashCents: 0, cardCents: 0, creditCents: totalCents, clientId: null }
  }

  async function confirmPay(): Promise<void> {
    if (!confirmEnabled.value || paying.value) return
    const t = total.value
    const totalCents = Math.round(t * 100)
    const catalog = useCatalogStore()
    const request: CreateSaleRequest = {
      items: ticket.value.map((l) => ({
        productId: l.id,
        quantity: l.qty,
        unitPriceCents: Math.round(l.price * 100),
        accountingGroupId: catalog.accountingGroupIdFor(l.id)
      })),
      payment: buildPayment(totalCents)
    }

    paying.value = true
    payError.value = ''
    try {
      const sale = await window.api.sales.create(request)
      lastTicketNumber.value = sale.ticketNumber
      lastSale.value = sale
    } catch {
      payError.value = 'No se pudo registrar la venta. Inténtalo de nuevo.'
      return
    } finally {
      paying.value = false
    }

    if (payMethod.value === 'efectivo') {
      payChange.value = cashGiven.value - t
      payResultLabel.value = `Pago en efectivo · ${eur(t)}`
    } else if (payMethod.value === 'tarjeta') {
      payChange.value = 0
      payResultLabel.value = `Pago con tarjeta · ${eur(t)}`
    } else if (payMethod.value === 'mixto') {
      payChange.value = 0
      const cash = Math.min(Math.max(0, mixedCashEur.value), t)
      payResultLabel.value = `Mixto · ${eur(cash)} efectivo + ${eur(t - cash)} tarjeta`
    } else {
      const c = clients.find((x) => x.id === fiadoClient.value)
      if (c) c.saldo += t
      payChange.value = 0
      payResultLabel.value = `Anotado a la cuenta de ${c ? c.name : ''}`
    }
    payDone.value = true
  }

  /** Clears everything and closes the modal, ready for the next sale. */
  function newTicket(): void {
    clearTicket()
    payOpen.value = false
    payDone.value = false
    cashGiven.value = 0
    fiadoClient.value = null
    payError.value = ''
    lastTicketNumber.value = ''
  }

  // --- Session ---
  function login(sessionUser: SessionUser): void {
    user.value = sessionUser
  }

  function logout(): void {
    user.value = null
    clearTicket()
  }

  return {
    user,
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
    confirmEnabled,
    addProduct,
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
