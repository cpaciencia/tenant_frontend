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
  taxRate: number
  categoryId: string | null
  active: boolean
  stock: number
}

export interface ProductUpsertBody {
  barcode?: string | null
  name: string
  priceCents: number
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

// --- Reporting: closures (cajas) + tickets (backend, web + desktop) ---
export interface ClosureView {
  id: string
  terminalId: string
  zNumber: number
  closedAt: string
  totalCents: number
  salesCount: number
}

export interface BreakdownRow {
  accountingGroupId: string | null
  code: string
  name: string
  totalCents: number
}

export interface TicketView {
  id: string
  ticketNumber: string
  terminalId: string
  createdAt: string
  totalCents: number
}

/** Cash/card/credit split (credit = fiado, not money in the till). */
export interface Tenders {
  cashCents: number
  cardCents: number
  creditCents: number
}

export interface ClosureDetail {
  closure: ClosureView
  tenders: Tenders
  breakdown: BreakdownRow[]
  tickets: TicketView[]
}

export interface CurrentTill {
  totalCents: number
  salesCount: number
  tenders: Tenders
  breakdown: BreakdownRow[]
}

export interface TicketLineView {
  productId: string | null
  name: string
  quantity: number
  unitPriceCents: number
  lineCents: number
}

export interface TicketDetail {
  ticket: TicketView
  lines: TicketLineView[]
}

export const listClosures = (): Promise<ClosureView[]> => apiFetch('/api/closures')
export const getCurrentTill = (): Promise<CurrentTill> => apiFetch('/api/closures/current')
export const getClosure = (id: string): Promise<ClosureDetail> => apiFetch(`/api/closures/${id}`)
export const listTickets = (page = 0, size = 50): Promise<TicketView[]> =>
  apiFetch(`/api/tickets?page=${page}&size=${size}`)
export const getTicket = (id: string): Promise<TicketDetail> => apiFetch(`/api/tickets/${id}`)
