import { BrowserWindow, ipcMain } from 'electron'
import type { DB } from '../db/connection'
import { IpcChannels } from '../../shared/ipc'
import {
  RENDERER_AUDIT_TYPES,
  type Actor,
  type AuditEventInput,
  type ResolvePendingRequest
} from '../../shared/types'
import type {
  AcceptSessionRequest,
  AppSettings,
  CartItemInput,
  CartState,
  CloseSessionRequest,
  CreateSaleRequest,
  EnrollRequest,
  OpenSessionRequest
} from '../../shared/types'
import { listProducts, getProductByBarcode } from '../repositories/products'
import { unitsSoldByProduct } from '../repositories/salesRanking'
import { listCategories } from '../repositories/categories'
import { getSettings, updateSettings } from '../repositories/settings'
import { countTotals, requeueAll } from '../repositories/syncQueue'
import { createSale } from '../services/sales'
import {
  openCashSession,
  acceptCashSession,
  getCurrentCashSession,
  lastClosingFloat,
  listCashSessions,
  previewSessionArqueo,
  closeCashSession
} from '../services/cashSession'
import { exportHtmlToPdf, MAX_PDF_HTML_LENGTH } from '../windows/pdfExport'
import { completePendingItem, dismissPendingItem, listPendingItems } from '../services/pendingItems'
import { recordAuditEvent } from '../repositories/auditEvents'
import {
  discardParkedTicket,
  listParkedTickets,
  parkTicket,
  resumeParkedTicket
} from '../services/parkedTickets'
import type { CashMovementKind, OpenTicketLine } from '../../shared/types'
import {
  currentCashMovements,
  markInvoiceUploaded,
  recordCashMovement
} from '../services/cashMovements'
import { listSuppliers } from '../repositories/suppliers'
import { pullSuppliers } from '../sync/supplierPull'
import { AuthService } from '../services/auth'
import { pullCategories } from '../sync/categoryPull'
import { pullProducts } from '../sync/productPull'
import { pullAccountingGroups } from '../sync/accountingGroupPull'
import { pullUsers } from '../sync/userPull'
import type { CustomerDisplayManager } from '../windows/customerDisplay'
import type { SyncWorker } from '../sync/worker'
import type { EnrollmentService } from '../enrollment/service'

/** Anything arriving over IPC is untrusted input — validate before it reaches the DB. */
function assertCreateSaleRequest(value: unknown): asserts value is CreateSaleRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as CreateSaleRequest).items)
  ) {
    throw new Error('Invalid sale request: "items" must be an array')
  }
  for (const item of (value as CreateSaleRequest).items as CartItemInput[]) {
    // unitPriceCents may be negative on purpose: deposit/"fianza" refund products
    // (e.g. returning the adapter) carry a negative price so the line subtracts.
    // A line without a catalog product is only valid as a manual line.
    const manual = item?.manual
    const validManual =
      manual == null ||
      (typeof manual === 'object' &&
        (manual.kind === 'quick' || manual.kind === 'not_found') &&
        (manual.barcode == null || typeof manual.barcode === 'string') &&
        (manual.name == null || typeof manual.name === 'string') &&
        (manual.categoryId == null || typeof manual.categoryId === 'string'))
    if (
      !validManual ||
      (manual == null ? typeof item?.productId !== 'string' : item.productId != null) ||
      typeof item?.name !== 'string' ||
      !Number.isFinite(item?.quantity) ||
      item.quantity <= 0 ||
      !Number.isInteger(item?.unitPriceCents) ||
      (item.accountingGroupId != null && typeof item.accountingGroupId !== 'string')
    ) {
      throw new Error('Invalid sale item in request')
    }
  }
  const payment = (value as CreateSaleRequest).payment
  // Tender amounts may be negative for a refund (cash/card handed back). The
  // service still enforces cash + card + credit === total, which is the real guard.
  if (
    typeof payment !== 'object' ||
    payment === null ||
    !Number.isInteger(payment.cashCents) ||
    !Number.isInteger(payment.cardCents) ||
    !Number.isInteger(payment.creditCents) ||
    (payment.clientId != null && typeof payment.clientId !== 'string') ||
    (payment.clientName != null && typeof payment.clientName !== 'string')
  ) {
    throw new Error('Invalid sale payment in request')
  }
  const { sellerUserId, sellerName, draftId } = value as CreateSaleRequest
  if (draftId != null && typeof draftId !== 'string') {
    throw new Error('Invalid sale request: draft id')
  }
  if (
    (sellerUserId != null && typeof sellerUserId !== 'string') ||
    typeof sellerName !== 'string' ||
    !sellerName.trim()
  ) {
    throw new Error('Invalid sale request: missing seller')
  }
  if (
    typeof (value as CreateSaleRequest).cashSessionId !== 'string' ||
    !(value as CreateSaleRequest).cashSessionId.trim()
  ) {
    throw new Error('Invalid sale request: missing cash session')
  }
}

/** A user reference from the renderer (name required). */
function parseActor(value: unknown): Actor {
  const a = (value ?? {}) as Partial<Actor>
  if (typeof a.name !== 'string' || !a.name.trim()) throw new Error('Invalid actor')
  return { userId: typeof a.userId === 'string' ? a.userId : null, name: a.name.trim() }
}

function parseResolveRequest(value: unknown, needsProduct: boolean): ResolvePendingRequest {
  const r = (value ?? {}) as Partial<ResolvePendingRequest>
  if (typeof r.id !== 'string' || !r.id.trim()) throw new Error('Invalid pending item id')
  if (needsProduct && (typeof r.productId !== 'string' || !r.productId.trim())) {
    throw new Error('Invalid product id')
  }
  return {
    id: r.id,
    productId: needsProduct ? (r.productId as string) : undefined,
    actor: parseActor(r.actor)
  }
}

/** Lines of an open ticket coming from the renderer (to park). */
function parseTicketLines(value: unknown): OpenTicketLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new Error('Invalid ticket lines')
  }
  return value.map((raw) => {
    const l = (raw ?? {}) as Partial<OpenTicketLine>
    if (
      typeof l.key !== 'string' ||
      typeof l.id !== 'string' ||
      typeof l.name !== 'string' ||
      !Number.isFinite(l.price) ||
      !Number.isInteger(l.qty) ||
      (l.qty as number) <= 0
    ) {
      throw new Error('Invalid ticket line')
    }
    const m = l.manual
    return {
      key: l.key,
      id: l.id,
      name: l.name,
      price: l.price as number,
      qty: l.qty as number,
      ...(m && (m.kind === 'quick' || m.kind === 'not_found')
        ? {
            manual: {
              kind: m.kind,
              barcode: typeof m.barcode === 'string' ? m.barcode : null,
              name: typeof m.name === 'string' ? m.name : null,
              categoryId: typeof m.categoryId === 'string' ? m.categoryId : null
            }
          }
        : {})
    }
  })
}

function parseParkedAction(value: unknown): { id: string; actor: Actor } {
  const r = (value ?? {}) as { id?: unknown; actor?: unknown }
  if (typeof r.id !== 'string' || !r.id.trim()) throw new Error('Invalid parked ticket id')
  return { id: r.id, actor: parseActor(r.actor) }
}

/** Audit detail must stay small and plain (it is synced and kept forever). */
const MAX_AUDIT_DATA_LENGTH = 4000

function isCartState(value: unknown): value is CartState {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as CartState).lines) &&
    Number.isFinite((value as CartState).totalCents)
  )
}

/**
 * Enrolment handlers — registered at startup, BEFORE any database exists, since
 * the setup screen runs before the terminal is enrolled (and thus before the
 * encrypted DB can be opened).
 */
export function registerEnrollmentHandlers(enrollment: EnrollmentService): void {
  ipcMain.handle(IpcChannels.enrollmentGetState, () => enrollment.getState())

  ipcMain.handle(IpcChannels.enrollmentTestConnection, (_event, syncApiUrl: unknown) => {
    if (typeof syncApiUrl !== 'string' || syncApiUrl.trim().length === 0) {
      throw new Error('Invalid backend URL')
    }
    return enrollment.testConnection(syncApiUrl)
  })

  ipcMain.handle(IpcChannels.enrollmentEnroll, (_event, request: unknown) => {
    const { syncApiUrl, terminalId, code } = (request ?? {}) as Partial<EnrollRequest>
    if (
      typeof syncApiUrl !== 'string' ||
      typeof terminalId !== 'string' ||
      typeof code !== 'string' ||
      !syncApiUrl.trim() ||
      !terminalId.trim() ||
      !code.trim()
    ) {
      throw new Error('Invalid enrolment request')
    }
    return enrollment.enroll(syncApiUrl.trim(), terminalId.trim(), code.trim())
  })

  ipcMain.handle(IpcChannels.enrollmentReset, () => enrollment.reset())

  ipcMain.handle(IpcChannels.enrollmentUpdateUrl, (_event, syncApiUrl: unknown) => {
    if (typeof syncApiUrl !== 'string' || !syncApiUrl.trim()) {
      throw new Error('Invalid backend URL')
    }
    let parsed: URL
    try {
      parsed = new URL(syncApiUrl.trim())
    } catch {
      throw new Error('Invalid backend URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('La URL debe empezar por http:// o https://')
    }
    return enrollment.updateSyncApiUrl(syncApiUrl.trim())
  })
}

/**
 * Database-backed handlers — registered only once the encrypted DB is open (i.e.
 * after enrolment). Each channel maps 1:1 to a method on the `IpcApi` surface.
 */
export function registerDbHandlers(
  db: DB,
  customerDisplay: CustomerDisplayManager,
  getSyncApiUrl: () => string,
  syncWorker: SyncWorker
): void {
  const auth = new AuthService(db, getSyncApiUrl)

  ipcMain.handle(IpcChannels.authLogin, async (_event, username: unknown, password: unknown) => {
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim()) {
      throw new Error('Invalid login request')
    }
    const terminalId = getSettings(db).terminalId
    try {
      const session = await auth.login(username.trim(), password)
      recordAuditEvent(db, {
        type: 'auth.login',
        terminalId,
        actor: { userId: session.user.id, name: session.user.fullName || session.user.username },
        data: { username: session.user.username, online: Boolean(session.token) }
      })
      return session
    } catch (e) {
      recordAuditEvent(db, {
        type: 'auth.login_failed',
        terminalId,
        actor: null,
        data: { username: username.trim() }
      })
      throw e
    }
  })

  ipcMain.handle(IpcChannels.productsList, () => listProducts(db))

  ipcMain.handle(IpcChannels.productsSalesRanking, () => unitsSoldByProduct(db))

  ipcMain.handle(IpcChannels.categoriesList, () => listCategories(db))

  ipcMain.handle(IpcChannels.productsGetByBarcode, (_event, barcode: unknown) => {
    if (typeof barcode !== 'string') {
      throw new Error('Invalid barcode')
    }
    return getProductByBarcode(db, barcode)
  })

  ipcMain.handle(IpcChannels.salesCreate, (_event, request: unknown) => {
    assertCreateSaleRequest(request)
    // The terminal prefix comes from the persisted settings, not a static env.
    return createSale(db, getSettings(db).terminalId, {
      ...request,
      sellerName: request.sellerName.trim(),
      payment: { ...request.payment, clientName: request.payment.clientName?.trim() || null }
    })
  })

  // --- Cash sessions (caja por turno) — the single cierre ---
  ipcMain.handle(IpcChannels.cashSessionOpen, (_event, request: unknown) => {
    const r = (request ?? {}) as Partial<OpenSessionRequest>
    if (typeof r.cashierName !== 'string' || !r.cashierName.trim()) {
      throw new Error('Invalid open-session request: cashier required')
    }
    if (!Number.isFinite(r.openingFloatCents) || (r.openingFloatCents as number) < 0) {
      throw new Error('Invalid open-session request: float')
    }
    if (r.shiftId != null && typeof r.shiftId !== 'string') {
      throw new Error('Invalid open-session request: shift')
    }
    const settings = getSettings(db)
    return openCashSession(
      db,
      settings.terminalId,
      {
        cashierUserId: typeof r.cashierUserId === 'string' ? r.cashierUserId : null,
        cashierName: r.cashierName.trim(),
        openingFloatCents: r.openingFloatCents as number,
        shiftId: r.shiftId ?? null
      },
      settings.shifts
    )
  })

  ipcMain.handle(IpcChannels.cashSessionCurrent, () =>
    getCurrentCashSession(db, getSettings(db).terminalId)
  )

  ipcMain.handle(IpcChannels.cashSessionLastFloat, () =>
    lastClosingFloat(db, getSettings(db).terminalId)
  )

  ipcMain.handle(IpcChannels.cashSessionAccept, (_event, request: unknown) => {
    const r = (request ?? {}) as Partial<AcceptSessionRequest>
    if (typeof r.sessionId !== 'string' || !r.sessionId.trim()) {
      throw new Error('Invalid accept request: session id')
    }
    if (typeof r.userName !== 'string' || !r.userName.trim()) {
      throw new Error('Invalid accept request: user required')
    }
    if (
      r.openingFloatCents != null &&
      (!Number.isFinite(r.openingFloatCents) || r.openingFloatCents < 0)
    ) {
      throw new Error('Invalid accept request: float')
    }
    return acceptCashSession(db, getSettings(db).terminalId, {
      sessionId: r.sessionId,
      userId: typeof r.userId === 'string' ? r.userId : null,
      userName: r.userName.trim(),
      openingFloatCents: r.openingFloatCents ?? null
    })
  })

  ipcMain.handle(IpcChannels.cashSessionArqueo, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('Invalid session id')
    }
    return previewSessionArqueo(db, sessionId)
  })

  ipcMain.handle(IpcChannels.cashSessionClose, (_event, request: unknown) => {
    const r = (request ?? {}) as Partial<CloseSessionRequest>
    if (typeof r.sessionId !== 'string' || !r.sessionId.trim()) {
      throw new Error('Invalid close-session request: session id')
    }
    if (!Number.isFinite(r.countedCashCents) || !Number.isFinite(r.closingFloatCents)) {
      throw new Error('Invalid close-session request: amounts')
    }
    if (typeof r.closedByName !== 'string' || !r.closedByName.trim()) {
      throw new Error('Invalid close-session request: closer required')
    }
    const settings = getSettings(db)
    if (
      r.cashOutCents != null &&
      (!Number.isInteger(r.cashOutCents) || (r.cashOutCents as number) < 0)
    ) {
      throw new Error('Invalid close-session request: book return')
    }
    return closeCashSession(
      db,
      settings.terminalId,
      {
        cashOutCents: r.cashOutCents ?? null,
        sessionId: r.sessionId,
        countedCashCents: r.countedCashCents as number,
        closingFloatCents: r.closingFloatCents as number,
        closedByUserId: typeof r.closedByUserId === 'string' ? r.closedByUserId : null,
        closedByName: r.closedByName.trim()
      },
      settings.shifts
    )
  })

  ipcMain.handle(IpcChannels.cashSessionHistory, () => listCashSessions(db))

  ipcMain.handle(IpcChannels.pendingItemsList, () => listPendingItems(db))

  ipcMain.handle(IpcChannels.pendingItemsComplete, (_event, request: unknown) =>
    completePendingItem(db, getSettings(db).terminalId, parseResolveRequest(request, true))
  )

  ipcMain.handle(IpcChannels.pendingItemsDismiss, (_event, request: unknown) =>
    dismissPendingItem(db, getSettings(db).terminalId, parseResolveRequest(request, false))
  )

  ipcMain.handle(IpcChannels.cashMovementsRecord, (_event, request: unknown) => {
    const r = (request ?? {}) as Record<string, unknown>
    const optionalText = (v: unknown, max: number): string | null => {
      if (v == null) return null
      if (typeof v !== 'string' || v.length > max) throw new Error('Invalid cash movement text')
      return v
    }
    if (!['supplier_payment', 'other_payment', 'cash_in', 'cash_out'].includes(String(r.kind))) {
      throw new Error('Invalid cash movement kind')
    }
    if (!Number.isInteger(r.amountCents) || (r.amountCents as number) <= 0) {
      throw new Error('Invalid cash movement amount')
    }
    return recordCashMovement(db, getSettings(db).terminalId, {
      kind: r.kind as CashMovementKind,
      amountCents: r.amountCents as number,
      supplierId: optionalText(r.supplierId, 64),
      supplier: optionalText(r.supplier, 120),
      document: optionalText(r.document, 80),
      note: optionalText(r.note, 300),
      actor: parseActor(r.actor)
    })
  })

  ipcMain.handle(IpcChannels.cashMovementsCurrent, () =>
    currentCashMovements(db, getSettings(db).terminalId)
  )

  ipcMain.handle(IpcChannels.cashMovementsSuppliers, () => listSuppliers(db))

  ipcMain.handle(IpcChannels.cashMovementsInvoiceUploaded, (_event, request: unknown) => {
    const r = (request ?? {}) as Record<string, unknown>
    if (typeof r.cashMovementId !== 'string' || r.cashMovementId.length > 64) {
      throw new Error('Invalid cash movement id')
    }
    if (typeof r.fileName !== 'string' || !r.fileName || r.fileName.length > 200) {
      throw new Error('Invalid invoice file name')
    }
    if (r.via !== 'file' && r.via !== 'qr') throw new Error('Invalid invoice upload channel')
    return markInvoiceUploaded(db, getSettings(db).terminalId, {
      cashMovementId: r.cashMovementId,
      fileName: r.fileName,
      via: r.via,
      actor: parseActor(r.actor)
    })
  })

  ipcMain.handle(IpcChannels.parkedList, () => listParkedTickets(db, getSettings(db).terminalId))

  ipcMain.handle(IpcChannels.parkedPark, (_event, request: unknown) => {
    const r = (request ?? {}) as { draftId?: unknown; lines?: unknown; actor?: unknown }
    return parkTicket(db, getSettings(db).terminalId, {
      draftId: typeof r.draftId === 'string' ? r.draftId : null,
      lines: parseTicketLines(r.lines),
      actor: parseActor(r.actor)
    })
  })

  ipcMain.handle(IpcChannels.parkedResume, (_event, request: unknown) =>
    resumeParkedTicket(db, getSettings(db).terminalId, parseParkedAction(request))
  )

  ipcMain.handle(IpcChannels.parkedDiscard, (_event, request: unknown) =>
    discardParkedTicket(db, getSettings(db).terminalId, parseParkedAction(request))
  )

  ipcMain.handle(IpcChannels.auditRecord, (_event, value: unknown) => {
    const e = (value ?? {}) as Partial<AuditEventInput>
    if (!RENDERER_AUDIT_TYPES.includes(e.type as (typeof RENDERER_AUDIT_TYPES)[number])) {
      throw new Error('Invalid audit event type')
    }
    const data = typeof e.data === 'object' && e.data !== null ? e.data : {}
    if (JSON.stringify(data).length > MAX_AUDIT_DATA_LENGTH) {
      throw new Error('Audit event data too large')
    }
    recordAuditEvent(db, {
      type: e.type as string,
      terminalId: getSettings(db).terminalId,
      actor: parseActor(e.actor),
      cashSessionId: getCurrentCashSession(db, getSettings(db).terminalId)?.id ?? null,
      data
    })
  })

  ipcMain.handle(IpcChannels.printSavePdf, (event, html: unknown, fileName: unknown) => {
    if (typeof html !== 'string' || !html.trim() || html.length > MAX_PDF_HTML_LENGTH) {
      throw new Error('Invalid document')
    }
    if (typeof fileName !== 'string') {
      throw new Error('Invalid file name')
    }
    return exportHtmlToPdf(BrowserWindow.fromWebContents(event.sender), html, fileName)
  })

  // Fire-and-forget cart mirror from the cashier window.
  ipcMain.on(IpcChannels.customerDisplayUpdate, (_event, state: unknown) => {
    if (isCartState(state)) {
      customerDisplay.update(state)
    }
  })

  ipcMain.handle(IpcChannels.settingsGet, () => getSettings(db))

  ipcMain.handle(IpcChannels.settingsUpdate, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new Error('Invalid settings patch')
    }
    const settings = updateSettings(db, patch as Partial<AppSettings>)
    // Reflect the customer-display toggle on the actual window immediately.
    customerDisplay.setEnabled(settings.customerDisplayEnabled)
    return settings
  })

  ipcMain.handle(IpcChannels.syncStatus, () => countTotals(db))

  ipcMain.handle(IpcChannels.syncResync, async () => {
    // Re-arm every local sale/Z-closure, then push immediately. Recovery path for
    // when the backend DB was wiped; ingestion is idempotent so this is safe.
    const requeued = requeueAll(db)
    await syncWorker.drain()
    return { requeued, pending: countTotals(db).pending }
  })

  ipcMain.handle(IpcChannels.catalogRefresh, async () => {
    // Clean full re-pull: replaces each mirror with the backend's authoritative set,
    // dropping orphan rows (the POS-grid duplicates after a backend reset/re-import).
    // Best-effort per entity — a failed pull leaves that mirror untouched (count null).
    const baseUrl = getSyncApiUrl()
    const settled = await Promise.allSettled([
      pullAccountingGroups(db, baseUrl, undefined, { full: true }),
      pullCategories(db, baseUrl, undefined, { full: true }),
      pullProducts(db, baseUrl, undefined, { full: true }),
      pullUsers(db, baseUrl, undefined, { full: true }),
      pullSuppliers(db, baseUrl)
    ])
    const countAt = (i: number): number | null =>
      settled[i].status === 'fulfilled'
        ? (settled[i] as PromiseFulfilledResult<number>).value
        : null
    return {
      accountingGroups: countAt(0),
      categories: countAt(1),
      products: countAt(2),
      users: countAt(3)
    }
  })
}
