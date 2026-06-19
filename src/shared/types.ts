/**
 * Domain types shared across the Main process, the preload bridge, and the Vue
 * renderer. This is the ONLY code shared across the IPC boundary — keep it free
 * of any Node or Electron imports so it's safe to bundle into the renderer.
 */

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

/** One row of a Z-report: the takings of a single accounting group (caja). */
export interface ZBreakdownRow {
  /** Null for lines whose product had no caja resolved at sale time. */
  accountingGroupId: string | null
  code: string
  name: string
  totalCents: number
}

/** Live preview of what the next cash-up (Z) would total, by caja. */
export interface ZReport {
  salesCount: number
  totalCents: number
  breakdown: ZBreakdownRow[]
}

/** A persisted Z closure (the sealed cash-up record). */
export interface ZClosure extends ZReport {
  id: string
  terminalId: string
  zNumber: number
  closedAt: string
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

export interface CartItemInput {
  productId: string
  quantity: number
  unitPriceCents: number
  /**
   * Accounting group (caja) this line rolls up into, snapshotted at sale time so
   * the Z-report stays stable if the product is later reclassified. Null when the
   * product's category has no caja resolved (shouldn't happen in normal flow).
   */
  accountingGroupId: string | null
}

/**
 * How a sale was paid. The three buckets sum to the sale total: cash + card go
 * into the till; credit is "a cuenta" (fiado) — a debt of {@link clientId}, not
 * money taken. In H1 credit is always 0 (fiado lands in a later phase).
 */
export interface SalePayment {
  cashCents: number
  cardCents: number
  creditCents: number
  clientId: string | null
}

export interface CreateSaleRequest {
  items: CartItemInput[]
  payment: SalePayment
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
  businessPhone: ''
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
