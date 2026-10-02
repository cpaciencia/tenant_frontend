import { apiFetch } from './http'

/**
 * Backoffice management client (users, roles, permission catalogue). Shared by web
 * and POS — both talk to the cloud backend over HTTP, since these entities are
 * centrally owned. Endpoints are gated server-side by granular permissions.
 */

export interface Override {
  key: string
  granted: boolean
}

export interface AdminUser {
  id: string
  username: string
  fullName: string | null
  roleId: string | null
  roleName: string
  active: boolean
  overrides: Override[]
  updatedAt: string
}

export interface AdminRole {
  id: string
  name: string
  description: string | null
  permissions: string[]
  updatedAt: string
}

export interface CatalogPermission {
  key: string
  description: string
}

export interface AdminAccountingGroup {
  id: string
  code: string
  name: string
  active: boolean
  updatedAt: string
}

export interface AdminCategory {
  id: string
  name: string
  parentId: string | null
  accountingGroupId: string
  color: string | null
  icon: string | null
  active: boolean
  updatedAt: string
}

// --- Users ---
export const listUsers = (): Promise<AdminUser[]> => apiFetch('/api/admin/users')

export const createUser = (body: {
  username: string
  password: string
  fullName?: string
  roleId?: string | null
  overrides?: Override[]
}): Promise<AdminUser> =>
  apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })

export const updateUser = (
  id: string,
  body: {
    fullName?: string
    roleId?: string | null
    active?: boolean
    /** Non-blank = reset the password. */
    password?: string
    overrides?: Override[]
  }
): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deactivateUser = (id: string): Promise<AdminUser> =>
  apiFetch(`/api/admin/users/${id}/deactivate`, { method: 'POST' })

// --- Roles ---
export const listRoles = (): Promise<AdminRole[]> => apiFetch('/api/roles')

export const createRole = (body: {
  name: string
  description?: string
  permissions: string[]
}): Promise<AdminRole> => apiFetch('/api/roles', { method: 'POST', body: JSON.stringify(body) })

export const updateRole = (
  id: string,
  body: { name: string; description?: string; permissions: string[] }
): Promise<AdminRole> => apiFetch(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteRole = (id: string): Promise<void> =>
  apiFetch(`/api/roles/${id}`, { method: 'DELETE' })

// --- Permission catalogue ---
export const listPermissions = (): Promise<CatalogPermission[]> => apiFetch('/api/permissions')

// --- Accounting groups (cajas por categoría) ---
export const listAccountingGroups = (): Promise<AdminAccountingGroup[]> =>
  apiFetch('/api/accounting-groups')

export const createAccountingGroup = (body: {
  code: string
  name: string
  active?: boolean
}): Promise<AdminAccountingGroup> =>
  apiFetch('/api/accounting-groups', { method: 'POST', body: JSON.stringify(body) })

export const updateAccountingGroup = (
  id: string,
  body: { code: string; name: string; active?: boolean }
): Promise<AdminAccountingGroup> =>
  apiFetch(`/api/accounting-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteAccountingGroup = (id: string): Promise<void> =>
  apiFetch(`/api/accounting-groups/${id}`, { method: 'DELETE' })

// --- Categories ---
export interface CategoryUpsertBody {
  name: string
  parentId?: string | null
  accountingGroupId: string
  color?: string | null
  icon?: string | null
  active?: boolean
}

export const listCategories = (): Promise<AdminCategory[]> => apiFetch('/api/categories')

export const createCategory = (body: CategoryUpsertBody): Promise<AdminCategory> =>
  apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(body) })

export const updateCategory = (id: string, body: CategoryUpsertBody): Promise<AdminCategory> =>
  apiFetch(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteCategory = (id: string): Promise<void> =>
  apiFetch(`/api/categories/${id}`, { method: 'DELETE' })

// --- Products ---
export interface AdminProduct {
  id: string
  barcode: string | null
  name: string
  priceCents: number
  /** Unit purchase price; 0 = not entered yet (shown as missing). */
  costCents: number
  taxRate: number
  categoryId: string | null
  active: boolean
  stock: number
}

export interface ProductUpsertBody {
  barcode?: string | null
  name: string
  priceCents: number
  costCents?: number
  taxRate: number
  categoryId: string
  active?: boolean
}

export const listProducts = (): Promise<AdminProduct[]> => apiFetch('/api/products')

export const createProduct = (body: ProductUpsertBody): Promise<AdminProduct> =>
  apiFetch('/api/products', { method: 'POST', body: JSON.stringify(body) })

export const updateProduct = (id: string, body: ProductUpsertBody): Promise<AdminProduct> =>
  apiFetch(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) })

export const deleteProduct = (id: string): Promise<void> =>
  apiFetch(`/api/products/${id}`, { method: 'DELETE' })

export const setProductStock = (id: string, stock: number): Promise<AdminProduct> =>
  apiFetch(`/api/products/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ stock }) })

// --- Legacy import ---
export interface ImportSummary {
  cajasCreated: number
  cajasUpdated: number
  categoriesCreated: number
  categoriesUpdated: number
  productsCreated: number
  productsUpdated: number
  productsSkipped: number
}

export const importLegacy = (categorias: File, productos: File): Promise<ImportSummary> => {
  const form = new FormData()
  form.append('categorias', categorias)
  form.append('productos', productos)
  return apiFetch('/api/admin/import/legacy', { method: 'POST', body: form })
}

// --- Reporting: cierres de caja + tickets (backend, web + desktop) ---
export interface BreakdownRow {
  accountingGroupId: string | null
  code: string
  name: string
  totalCents: number
}

/** Cash/card/credit split (credit = fiado, not money in the till). */
export interface Tenders {
  cashCents: number
  cardCents: number
  creditCents: number
}

export interface CurrentTill {
  totalCents: number
  salesCount: number
  tenders: Tenders
  breakdown: BreakdownRow[]
}

/** Pending till: sales made but not yet sealed by a cierre (open cajas). */
export const getCurrentTill = (): Promise<CurrentTill> => apiFetch('/api/cash-sessions/current')

/** A credit ("fiado") sale inside a cierre. */
export interface FiadoView {
  saleId: string
  ticketNumber: string
  clientId: string | null
  clientName: string
  amountCents: number
  createdAt: string
}

/** Takings of one user inside a caja. */
export interface SellerView {
  userId: string | null
  name: string
  salesCount: number
  totalCents: number
}

/**
 * A cierre de caja as projected on the backend — the single closing. A caja
 * belongs to a shift (turno) on a business date; `responsibleName` answers for
 * it and `closedByName` did the arqueo. `zNumber` is the fiscal per-terminal
 * sequential number, allocated at close.
 */
export interface CashSessionView {
  id: string
  terminalId: string
  shiftId: string | null
  shiftName: string | null
  businessDate: string | null
  cashierUserId: string | null
  cashierName: string
  responsibleUserId: string | null
  responsibleName: string | null
  closedByUserId: string | null
  closedByName: string | null
  openedAt: string
  openingFloatCents: number
  status: 'open' | 'closed'
  closedAt: string | null
  expectedCashCents: number | null
  countedCashCents: number | null
  differenceCents: number | null
  closingFloatCents: number | null
  zNumber: number | null
  salesCount: number
  totalCents: number
  tenders: Tenders
  breakdown: BreakdownRow[]
  fiados: FiadoView[]
  sellers: SellerView[]
  /** Supplier payments and cash in/out of the caja. */
  cashMovements: {
    id: string
    kind: string
    amountCents: number
    supplier: string | null
    document: string | null
    note: string | null
    userName: string
    createdAt: string
  }[]
  /** Corrections of the drawer float while the caja was open. */
  floatAdjustments: {
    at: string
    userId: string | null
    userName: string
    fromCents: number
    toCents: number
  }[]
}

export const listCashSessions = (): Promise<CashSessionView[]> => apiFetch('/api/cash-sessions')
/** Cajas open right now (one per terminal), with live figures from the synced sales. */
export const listOpenCashSessions = (): Promise<CashSessionView[]> =>
  apiFetch('/api/cash-sessions/open')

// --- Pending items (lines sold by price without a catalog product) ---

/** The real product to create for a pending line. */
export interface CompletePendingBody {
  name: string
  categoryId: string
  priceCents: number
  costCents: number
  taxRate: number
  barcode: string | null
}

/**
 * Create the catalog product for a pending line (permission `pending_item:resolve`)
 * and link its sales when the server already has it.
 */
export const completePendingOnServer = (
  id: string,
  body: CompletePendingBody
): Promise<{ product: AdminProduct; linked: boolean }> =>
  apiFetch(`/api/pending-items/${id}/complete`, { method: 'POST', body: JSON.stringify(body) })

// --- Actividad (audit log + per-user figures; permission `activity:read`) ---

export interface ActivityEvent {
  id: string
  type: string
  occurredAt: string
  terminalId: string
  userId: string | null
  userName: string | null
  cashSessionId: string | null
  entityId: string | null
  data: Record<string, unknown>
}

export interface ActivityEventPage {
  total: number
  page: number
  size: number
  items: ActivityEvent[]
}

export interface ActivityTotals {
  tickets: number
  salesCents: number
  manualLines: number
  manualCents: number
  linesRemoved: number
  linesRemovedCents: number
  ticketsCleared: number
  ticketsClearedCents: number
  paymentsCancelled: number
  /** Voids after opening the payment / typing cash, discarded parked tickets… */
  suspicious: number
  scansNotFound: number
  failedLogins: number
  pendingOpen: number
  cashDifferenceCents: number
}

export interface UserActivity {
  userName: string
  tickets: number
  salesCents: number
  avgTicketCents: number
  manualLines: number
  manualCents: number
  linesRemoved: number
  linesRemovedCents: number
  qtyDecreased: number
  ticketsCleared: number
  ticketsClearedCents: number
  paymentsCancelled: number
  /** Voids after opening the payment / typing cash, discarded parked tickets… */
  suspicious: number
  scansNotFound: number
  logins: number
  firstSeen: string | null
  lastSeen: string | null
}

export interface ActivitySummary {
  from: string
  to: string
  totals: ActivityTotals
  users: UserActivity[]
  byHour: { hour: number; tickets: number; salesCents: number }[]
  byDay: { date: string; tickets: number; salesCents: number; manualLines: number }[]
  cajas: {
    cashSessionId: string
    terminalId: string
    shiftName: string | null
    businessDate: string | null
    zNumber: number | null
    responsibleName: string | null
    closedByName: string | null
    closedAt: string | null
    totalCents: number
    differenceCents: number | null
    floatCorrections: number
  }[]
  failedLogins: { occurredAt: string; terminalId: string; username: string | null }[]
}

export interface ActivityQuery {
  from: string
  to: string
  terminal?: string | null
  user?: string | null
  types?: string[]
  q?: string
  page?: number
  size?: number
}

function activityParams(q: ActivityQuery): string {
  const p = new URLSearchParams({ from: q.from, to: q.to })
  if (q.terminal) p.set('terminal', q.terminal)
  if (q.user) p.set('user', q.user)
  if (q.types?.length) p.set('types', q.types.join(','))
  if (q.q?.trim()) p.set('q', q.q.trim())
  if (q.page !== undefined) p.set('page', String(q.page))
  if (q.size !== undefined) p.set('size', String(q.size))
  return p.toString()
}

export const getActivityEvents = (q: ActivityQuery): Promise<ActivityEventPage> =>
  apiFetch(`/api/activity/events?${activityParams(q)}`)

export const getActivitySummary = (q: ActivityQuery): Promise<ActivitySummary> =>
  apiFetch(
    `/api/activity/summary?${activityParams({ from: q.from, to: q.to, terminal: q.terminal })}`
  )

export const getActivityFilters = (): Promise<{
  users: string[]
  terminals: string[]
  types: string[]
}> => apiFetch('/api/activity/filters')

// --- Ticket browser (filters by period, caja, seller, payment…; `sale:read`) ---

export interface TicketRow {
  saleId: string
  ticketNumber: string
  terminalId: string
  createdAt: string
  sellerName: string | null
  cashSessionId: string | null
  shiftName: string | null
  businessDate: string | null
  zNumber: number | null
  cajaStatus: string | null
  cajaResponsible: string | null
  paymentMethod: 'efectivo' | 'tarjeta' | 'mixto' | 'a_cuenta'
  totalCents: number
  cashCents: number
  cardCents: number
  creditCents: number
  creditClient: string | null
  lines: number
  manualLines: number
}

export interface TicketPage {
  total: number
  totalCents: number
  page: number
  size: number
  items: TicketRow[]
}

export interface TicketFullLine {
  productId: string | null
  productName: string | null
  barcode: string | null
  topCategory: string | null
  subcategory: string | null
  accountingGroup: string | null
  quantity: number
  unitPriceCents: number
  lineCents: number
  manual: boolean
  manualKind: string | null
  manualBarcode: string | null
}

export interface TicketFull {
  ticket: TicketRow
  lines: TicketFullLine[]
  history: ActivityEvent[]
}

export interface CajaOption {
  cashSessionId: string
  terminalId: string
  shiftName: string | null
  businessDate: string | null
  zNumber: number | null
  status: string
  responsibleName: string | null
}

export interface TicketQuery {
  from: string
  to: string
  terminal?: string | null
  caja?: string | null
  seller?: string | null
  method?: string | null
  q?: string
  manualOnly?: boolean
  page?: number
  size?: number
}

export function searchTickets(q: TicketQuery): Promise<TicketPage> {
  const p = new URLSearchParams({ from: q.from, to: q.to })
  if (q.terminal) p.set('terminal', q.terminal)
  if (q.caja) p.set('caja', q.caja)
  if (q.seller) p.set('seller', q.seller)
  if (q.method) p.set('method', q.method)
  if (q.q?.trim()) p.set('q', q.q.trim())
  if (q.manualOnly) p.set('manualOnly', 'true')
  p.set('page', String(q.page ?? 0))
  p.set('size', String(q.size ?? 50))
  return apiFetch(`/api/tickets/search?${p.toString()}`)
}

export const getTicketFull = (id: string): Promise<TicketFull> =>
  apiFetch(`/api/tickets/${id}/full`)

export const listTicketCajas = (from: string, to: string): Promise<CajaOption[]> =>
  apiFetch(`/api/tickets/cajas?from=${from}&to=${to}`)

export const listTicketSellers = (from: string, to: string): Promise<string[]> =>
  apiFetch(`/api/tickets/sellers?from=${from}&to=${to}`)
