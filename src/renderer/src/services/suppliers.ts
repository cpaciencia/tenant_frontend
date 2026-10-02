/** Suppliers on the backend (HTTP) — the backoffice "Proveedores" screen. */
import { apiFetch } from './http'

export interface SupplierSummary {
  id: string
  name: string
  taxId: string | null
  phone: string | null
  active: boolean
  createdByName: string | null
  createdAt: string
  paymentsCount: number
  paidCents: number
  /** Payments to this supplier whose invoice isn't on the server. */
  invoicesMissing: number
  lastPaymentAt: string | null
}

export interface SupplierInput {
  name: string
  taxId: string | null
  phone: string | null
  active: boolean
}

export function listSupplierSummaries(): Promise<SupplierSummary[]> {
  return apiFetch<SupplierSummary[]>('/api/suppliers')
}

export function createSupplier(body: SupplierInput): Promise<unknown> {
  return apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(body) })
}

export function updateSupplier(id: string, body: SupplierInput): Promise<unknown> {
  return apiFetch(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}
