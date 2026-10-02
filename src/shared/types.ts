/**
 * Domain types shared across the Main process, the preload bridge, and the Vue
 * renderer. This is the ONLY code shared across the IPC boundary — keep it free
 * of any Node or Electron imports so it's safe to bundle into the renderer.
 */

import { DEFAULT_SHIFTS, type ShiftDefinition } from './shifts'

export interface Product {
  id: string
  barcode: string | null
  name: string
  priceCents: number
  taxRate: number
  active: boolean
  /** Category this product belongs to (null only for legacy/un-categorised rows). */
  categoryId: string | null
  /** Shared stock mirrored from the backend (authoritative count lives there). */
  stock: number
}

/** One row of a cierre: the takings of a single accounting group (caja). */
export interface ZBreakdownRow {
  /** Null for lines whose product had no caja resolved at sale time. */
  accountingGroupId: string | null
  code: string
  name: string
  totalCents: number
}

/** A category as mirrored locally for the POS (projection of the backend tree). */
export interface Category {
  id: string
  name: string
  parentId: string | null
  accountingGroupId: string
  color: string | null
  icon: string | null
  active: boolean
}

/**
 * How a line was rung without a known product: `quick` = the "Producto" (no barcode) button
 * (just a price); `not_found` = a scanned barcode that isn't in the catalog. Both
 * become pending items to be completed (or dismissed) later.
 */
export type ManualItemKind = 'quick' | 'not_found'

/** Extra data of a line rung without a catalog product. */
export interface ManualItemInput {
  kind: ManualItemKind
  /** The barcode that was scanned but not found (not_found only). */
  barcode: string | null
  /** Optional data the cashier already typed (name, category). */
  name: string | null
  categoryId: string | null
}

export interface CartItemInput {
  /** Catalog product; null only for a manual line (see `manual`). */
  productId: string | null
  /** Name shown on the ticket, snapshotted for reports. */
  name: string
  quantity: number
  unitPriceCents: number
  /**
   * Accounting group this line rolls up into, snapshotted at sale time so the
   * cierre stays stable if the product is later reclassified. Null when the
   * product's category has no group resolved (shouldn't happen in normal flow).
   */
  accountingGroupId: string | null
  /** Present when the line was rung by price without a catalog product. */
  manual?: ManualItemInput | null
}

/**
 * A line sold without a catalog product, waiting for someone to complete it
 * (create the real product — then the sale is linked to it) or dismiss it.
 */
export interface PendingItem {
  id: string
  terminalId: string
  saleId: string
  ticketNumber: string
  kind: ManualItemKind
  barcode: string | null
  name: string | null
  categoryId: string | null
  priceCents: number
  quantity: number
  createdAt: string
  createdByUserId: string | null
  createdByName: string
  status: 'pending' | 'completed' | 'dismissed'
  productId: string | null
  resolvedAt: string | null
  resolvedByUserId: string | null
  resolvedByName: string | null
}

/** Who did something on the till (recorded on pending items and audit events). */
export interface Actor {
  userId: string | null
  name: string
}

export interface ResolvePendingRequest {
  id: string
  /** The product created for it (completion); omitted when dismissing. */
  productId?: string
  actor: Actor
}

/**
 * Audit event types the renderer may report (UI actions the Main process can't
 * see). Everything else — sales, cajas, logins, pending items — is recorded by
 * Main itself.
 */
export const RENDERER_AUDIT_TYPES = [
  'auth.logout',
  'ticket.line_added',
  'payment.opened',
  'ticket.line_removed',
  'ticket.qty_decreased',
  'ticket.cleared',
  'payment.cancelled',
  'scan.not_found',
  'product.manual_added'
] as const
export type RendererAuditType = (typeof RENDERER_AUDIT_TYPES)[number]

export interface AuditEventInput {
  type: RendererAuditType
  actor: Actor
  /** Small JSON-able detail (ticket total, line name, barcode…). */
  data: Record<string, unknown>
}

/**
 * How a sale was paid. The three buckets sum to the sale total: cash + card go
 * into the till; credit is "a cuenta" (fiado) — a debt of the client, not money
 * taken. `clientName` is snapshotted so the cierre can say who was credited.
 */
export interface SalePayment {
  cashCents: number
  cardCents: number
  creditCents: number
  /** Backend client id (UUID) once real clients exist; null for ad-hoc/sample clients. */
  clientId: string | null
  clientName: string | null
}

/** A ticket line as kept in the till while the ticket is open (or parked). */
export interface OpenTicketLine {
  key: string
  id: string
  name: string
  price: number
  qty: number
  manual?: ManualItemInput
}

/** A ticket set aside unpaid to serve someone else, to be resumed later. */
export interface ParkedTicket {
  id: string
  /** Identity of the ticket being built (same across park/resume), for the audit trail. */
  draftId: string | null
  parkedAt: string
  parkedByUserId: string | null
  parkedByName: string
  lines: OpenTicketLine[]
  totalCents: number
}

export interface ParkTicketRequest {
  draftId: string | null
  lines: OpenTicketLine[]
  actor: Actor
}

export interface ParkedTicketActionRequest {
  id: string
  actor: Actor
}

export interface CreateSaleRequest {
  /** Identity of the ticket being built, to link the sale to its audit trail. */
  draftId?: string | null
  items: CartItemInput[]
  payment: SalePayment
  /** The open cash session (caja) this sale belongs to. Required: no open caja, no sale. */
  cashSessionId: string
  /** The logged-in user ringing the sale (several people may sell into one caja). */
  sellerUserId: string | null
  sellerName: string
  /**
   * A client's debt paid together with this purchase (one payment at the till).
   * Recorded as a separate account payment in the same transaction — not part of
   * the sale. Not allowed on a credit sale or a refund.
   */
  settlement?: { clientId: string; cashCents: number; cardCents: number } | null
}

/** Cash/card/credit split totalled across a set of sales. */
export interface Tenders {
  cashCents: number
  cardCents: number
  creditCents: number
}

/** A credit ("fiado") sale inside a cierre: who owes what. */
export interface FiadoEntry {
  saleId: string
  ticketNumber: string
  clientId: string | null
  clientName: string
  amountCents: number
  createdAt: string
}

/**
 * Cash moved in/out of the drawer that is not a sale:
 * - `supplier_payment`: paying a supplier from the drawer (its invoice is mandatory).
 * - `other_payment`: paying someone who issues no invoice (a gardener, an odd job):
 *   who (`supplier`, free text) and what for (`note`) are mandatory.
 * - `cash_in`: money put INTO the drawer from outside (e.g. to pay a supplier).
 * - `cash_out`: money taken out of the drawer (e.g. giving back what was put in).
 */
export type CashMovementKind = 'supplier_payment' | 'other_payment' | 'cash_in' | 'cash_out'

export interface CashMovement {
  id: string
  cashSessionId: string
  terminalId: string
  kind: CashMovementKind
  amountCents: number
  supplierId: string | null
  supplier: string | null
  document: string | null
  note: string | null
  userId: string | null
  userName: string
  createdAt: string
  /** Supplier payments only: 'pending' until the server stores its invoice. */
  invoiceStatus: InvoiceStatus | null
  invoiceFileName: string | null
  invoiceUploadedAt: string | null
}

export type InvoiceStatus = 'pending' | 'uploaded'

export interface Supplier {
  id: string
  name: string
}

/** Mark a supplier payment's invoice as stored by the server (after the upload succeeded). */
export interface MarkInvoiceUploadedRequest {
  cashMovementId: string
  fileName: string
  /** 'file' = uploaded from the till, 'qr' = from a phone via the QR link. */
  via: 'file' | 'qr'
  actor: Actor
}

export interface RecordCashMovementRequest {
  kind: CashMovementKind
  amountCents: number
  /** Picked from the list; when absent the supplier is found/created by name. */
  supplierId?: string | null
  supplier?: string | null
  document?: string | null
  note?: string | null
  actor: Actor
}

/** Who internal consumption is charged to ("Limpieza", "Dirección"…). */
export interface InternalAccount {
  id: string
  name: string
}

export interface InternalConsumptionItem {
  productId: string
  name: string
  quantity: number
  unitPriceCents: number
}

/**
 * Goods taken for internal use and never paid (cleaning, the owner…). NOT a sale:
 * own numbering `CI-T01-2026-00001`, no money, informative in the cierre; it
 * takes stock. Who takes it is mandatory.
 */
export interface InternalConsumption {
  id: string
  consumptionNumber: string
  terminalId: string
  accountId: string
  accountName: string
  takenByName: string
  reason: string | null
  items: InternalConsumptionItem[]
  /** Value at sale price. */
  totalCents: number
  cashSessionId: string
  userId: string | null
  userName: string
  createdAt: string
}

export interface RecordConsumptionRequest {
  items: InternalConsumptionItem[]
  accountId: string
  takenByName: string
  reason?: string | null
  cashSessionId: string
  draftId?: string | null
  actor: Actor
}

/** An "a cuenta" client and what they owe right now (all terminals). */
export interface Client {
  id: string
  name: string
  /** Pitch, bungalow, how to recognise them… */
  detail: string | null
  phone: string | null
  active: boolean
  balanceCents: number
}

export interface CreateClientRequest {
  name: string
  detail?: string | null
  phone?: string | null
  actor: Actor
}

/**
 * A payment of a client's debt (cobro de cuenta): cash/card into the caja of the
 * day, NOT a sale. Optionally taken together with a purchase (`saleId`).
 */
export interface AccountPayment {
  id: string
  /** `CC-T01-2026-00001` */
  paymentNumber: string
  terminalId: string
  clientId: string
  clientName: string
  cashCents: number
  cardCents: number
  totalCents: number
  cashSessionId: string
  saleId: string | null
  userId: string | null
  userName: string
  note: string | null
  createdAt: string
}

export interface SettleDebtRequest {
  clientId: string
  cashCents: number
  cardCents: number
  note?: string | null
  actor: Actor
}

/** Debt payments taken in a caja. */
export interface SettlementsSummary {
  cashCents: number
  cardCents: number
  totalCents: number
  list: AccountPayment[]
}

/** One line of a client's account as this till knows it. */
export interface ClientMovement {
  kind: 'credit_sale' | 'payment'
  id: string
  /** Ticket or payment number. */
  reference: string
  amountCents: number
  createdAt: string
  userName: string | null
}

export interface ClientAccount {
  client: Client
  /** What the client owes on other terminals (from the last sync). */
  otherTerminalsCents: number
  movements: ClientMovement[]
}

/** Totals of a caja's cash movements and how much put-in money is still to be taken out. */
export interface CashMovementsSummary {
  cashInCents: number
  cashOutCents: number
  supplierPaymentsCents: number
  /** Payments without invoice (`other_payment`). */
  otherPaymentsCents: number
  /** cash_in − cash_out: money put in that still has to be taken out. */
  cashInPendingCents: number
  /** Supplier payments whose invoice is not on the server yet (block the cierre). */
  invoicesPending: number
  list: CashMovement[]
}

/** A correction of an open caja's drawer float: who changed it, when, from → to. */
export interface FloatAdjustment {
  at: string
  userId: string | null
  userName: string
  fromCents: number
  toCents: number
}

/** Takings rung by one user inside a caja (several people can sell into one caja). */
export interface SellerTotal {
  userId: string | null
  name: string
  salesCount: number
  totalCents: number
}

/**
 * A till session ("caja"). It belongs to a SHIFT (turno) on a business date — not
 * to a cashier: there is exactly one open caja per terminal (one physical drawer),
 * everybody on duty sells into it with their own user, and each sale records who
 * rang it. Closing it (arqueo) immediately opens the next shift's caja with the
 * float left in the drawer, so selling never stops. That handover caja has no
 * responsible until someone logs in and accepts it (or, failing that, whoever
 * closes it becomes responsible).
 */
export interface CashSession {
  id: string
  terminalId: string
  /** Shift this caja serves; null for cajas opened before shifts existed. */
  shiftId: string | null
  shiftName: string | null
  /** Local business date (YYYY-MM-DD) of the shift. */
  businessDate: string | null
  /** Who opened the caja (for a handover caja: whoever closed the previous one). */
  cashierUserId: string | null
  cashierName: string
  openedAt: string
  openingFloatCents: number
  status: 'open' | 'closed'
  closedAt: string | null
  /** Who answers for this caja; null while a handover caja awaits acceptance. */
  responsibleUserId: string | null
  responsibleName: string | null
  acceptedAt: string | null
  /** Who did the arqueo and closed it — null while open. */
  closedByUserId: string | null
  closedByName: string | null
  /** Arqueo fields — null while the caja is still open. */
  expectedCashCents: number | null
  countedCashCents: number | null
  differenceCents: number | null
  closingFloatCents: number | null
  /** Fiscal per-terminal sequential cierre number, allocated at close (null while open). */
  zNumber: number | null
  salesCount: number
  totalCents: number
  tenders: Tenders
  breakdown: ZBreakdownRow[]
  fiados: FiadoEntry[]
  sellers: SellerTotal[]
  /** Float corrections made when the caja was accepted (oldest first). */
  floatAdjustments: FloatAdjustment[]
  /** Supplier payments and cash in/out recorded in this caja (sealed at close). */
  cashMovements: CashMovement[]
  /** Debt payments taken in this caja (cobros de cuentas). */
  settlements: AccountPayment[]
  /** Goods taken as internal consumption (informative). */
  internalConsumptions: InternalConsumption[]
}

export interface OpenSessionRequest {
  cashierUserId: string | null
  cashierName: string
  openingFloatCents: number
  /** Shift to open; defaults to the shift running now. */
  shiftId?: string | null
}

export interface CloseSessionRequest {
  sessionId: string
  countedCashCents: number
  closingFloatCents: number
  closedByUserId: string | null
  closedByName: string
  /** Money taken out at close (what was put in), recorded in the same step (optional). */
  cashOutCents?: number | null
}

export interface AcceptSessionRequest {
  sessionId: string
  userId: string | null
  userName: string
  /** The float the arriving cashier counted, when it differs from the one left. */
  openingFloatCents?: number | null
}

/** A cierre seals one caja and opens the next shift's caja in the same step. */
export interface CloseSessionResult {
  closed: CashSession
  next: CashSession
}

/**
 * Live arqueo of an open caja before sealing it: totals so far + expected cash
 * (opening float + net cash taken). The cashier counts the drawer and the close
 * records counted vs expected → difference.
 */
export interface SessionArqueo {
  sessionId: string
  shiftName: string | null
  businessDate: string | null
  cashierName: string
  openedAt: string
  openingFloatCents: number
  salesCount: number
  totalCents: number
  tenders: Tenders
  breakdown: ZBreakdownRow[]
  fiados: FiadoEntry[]
  sellers: SellerTotal[]
  /**
   * openingFloatCents + cash sales + money put in − supplier payments − money
   * taken out (cash refunds are already negative).
   */
  expectedCashCents: number
  /** Supplier payments and cash in/out of the caja. */
  movements: CashMovementsSummary
  /** Debt payments taken (cobros de cuentas): cash adds to the expected cash. */
  settlements: SettlementsSummary
  /** Internal consumption (informative: no money, not sales). */
  internalConsumptions: InternalConsumption[]
}

export interface Sale {
  id: string
  ticketNumber: string
  terminalId: string
  year: number
  sequence: number
  totalCents: number
  createdAt: string
  payment: SalePayment
  /** A client's debt paid together with this purchase, if any. */
  settlement?: AccountPayment | null
}

export interface CartLine {
  productId: string
  name: string
  quantity: number
  unitPriceCents: number
}

/** Snapshot of the cart mirrored to the customer-facing display. */
export interface CartState {
  lines: CartLine[]
  totalCents: number
}

/**
 * Per-terminal local configuration, persisted in SQLite and editable from the
 * Backoffice "Configuración" screen. These settings drive Main-process behaviour
 * (which terminal prefix tickets get, whether the customer display opens, printer
 * preferences), so they cross the IPC boundary like any other domain type.
 */
export interface AppSettings {
  /** Prefix of every ticket number this POS issues, e.g. "T01". */
  terminalId: string
  /** When false, the customer-facing display never opens (default). */
  customerDisplayEnabled: boolean
  /** Whether ticket printing is enabled (printing itself is out of scope for MVP1). */
  printerEnabled: boolean
  /** OS name of the selected receipt printer, or "" when none is chosen. */
  printerName: string
  /** Business header printed on the ticket (Mercadona-style receipt). */
  businessName: string
  businessAddress: string
  businessTaxId: string
  businessPhone: string
  /** Default cash float ("fondo de caja") a caja opens with and leaves on close, in cents. */
  cashFloatCents: number
  /** Shifts (turnos) a caja can belong to, e.g. Mañana 08–16 and Tarde 16–00. */
  shifts: ShiftDefinition[]
}

/**
 * Defaults applied on first run and as a fallback for any missing field. The
 * customer display is OFF by default — it only opens once explicitly enabled.
 *
 * Note: the backend URL lives OUTSIDE this (in the bootstrap config), because it
 * must be readable before the encrypted DB — which holds these settings — opens.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  terminalId: 'T01',
  customerDisplayEnabled: false,
  printerEnabled: false,
  printerName: '',
  businessName: 'Camping Parque Tropical',
  businessAddress: '',
  businessTaxId: '',
  businessPhone: '',
  cashFloatCents: 15000,
  shifts: DEFAULT_SHIFTS
}

/**
 * Terminal enrolment status, surfaced to the renderer so the app can route to
 * the setup screen before login when the terminal isn't enrolled yet.
 */
export interface EnrollmentState {
  /** True once the terminal holds issued credentials (sync token + DB key). */
  enrolled: boolean
  terminalId: string
  syncApiUrl: string
}

/** Result of a connectivity probe against a candidate backend URL. */
export interface ConnectionTestResult {
  ok: boolean
  message?: string
}

/** Input the renderer sends to enrol this terminal. */
export interface EnrollRequest {
  syncApiUrl: string
  terminalId: string
  code: string
}

/** Outcome of an enrolment attempt; `state` is the refreshed status on success. */
export interface EnrollResult {
  ok: boolean
  message?: string
  state?: EnrollmentState
}

/** Identity returned by a login (no password material ever crosses the bridge). */
export interface AuthSessionUser {
  id: string
  username: string
  fullName: string | null
  role: string
}

/**
 * Result of a login over IPC: identity + effective permission keys, plus a JWT
 * when the backend was reachable (absent for a purely offline login). The
 * renderer's auth store maps this into its session.
 */
export interface AuthSessionResult {
  user: AuthSessionUser
  permissions: string[]
  token?: string | null
}

/** Counts of the local outbound sync queue (sales + cierres de caja). */
export interface SyncStatus {
  /** Rows not yet acknowledged by the backend. */
  pending: number
  /** All rows ever enqueued (synced + pending). */
  total: number
}

/** Outcome of exporting a document to PDF (false when the user cancelled the save). */
export interface PdfExportResult {
  saved: boolean
  path?: string
}

/** Result of a forced re-sync: how many rows were re-queued and what's left pending. */
export interface SyncResyncResult {
  requeued: number
  pending: number
}

/**
 * Result of a clean catalog refresh (full re-pull that replaces each local mirror).
 * A count is the number of rows pulled; null means that entity's pull failed (e.g.
 * the backend was unreachable) and its mirror was left untouched.
 */
export interface CatalogRefreshResult {
  accountingGroups: number | null
  categories: number | null
  products: number | null
  users: number | null
}

/**
 * Envelope POSTed to the backend for each pending sync_queue row. The backend
 * (Step 6) mirrors this shape when receiving sync payloads.
 */
export interface SyncEnvelope {
  id: string
  entityType: string
  entityId: string
  operation: string
  payload: unknown
  createdAt: string
}
