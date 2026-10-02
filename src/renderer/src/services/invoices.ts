/**
 * Supplier invoices on the server (HTTP). The till uploads a payment's invoice or
 * shows a QR so a phone uploads it; the backoffice lists and downloads them.
 */
import { apiFetch, apiFetchBlob, HttpError } from './http'
import type { CashMovement } from '../../../shared/types'

export interface SupplierInvoice {
  id: string
  cashMovementId: string
  terminalId: string
  supplierId: string | null
  supplierName: string | null
  amountCents: number | null
  document: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  uploadedVia: 'file' | 'qr'
  uploadedByName: string | null
  uploadedAt: string
}

export interface UploadToken {
  token: string
  url: string
  expiresAt: string
}

/** Largest invoice the server accepts (backend multipart limit). */
export const MAX_INVOICE_BYTES = 15 * 1024 * 1024
export const INVOICE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic'

function metadata(m: CashMovement): Record<string, string> {
  const meta: Record<string, string> = {
    cashMovementId: m.id,
    terminalId: m.terminalId,
    amountCents: String(m.amountCents)
  }
  if (m.supplierId) meta.supplierId = m.supplierId
  if (m.supplier) meta.supplierName = m.supplier
  if (m.document) meta.document = m.document
  return meta
}

export async function uploadInvoice(m: CashMovement, file: File): Promise<SupplierInvoice> {
  if (file.size > MAX_INVOICE_BYTES) throw new Error('El archivo pesa más de 15 MB')
  const form = new FormData()
  form.append('file', file)
  const query = new URLSearchParams(metadata(m)).toString()
  return apiFetch<SupplierInvoice>(`/api/supplier-invoices?${query}`, {
    method: 'POST',
    body: form
  })
}

export function createUploadToken(m: CashMovement): Promise<UploadToken> {
  const meta = metadata(m)
  return apiFetch<UploadToken>('/api/supplier-invoices/upload-tokens', {
    method: 'POST',
    body: JSON.stringify({
      ...meta,
      amountCents: m.amountCents
    })
  })
}

/** Close a QR link that wasn't used (best-effort: it also expires by itself). */
export async function revokeUploadToken(token: string): Promise<void> {
  try {
    await apiFetch(`/api/supplier-invoices/upload-tokens/${encodeURIComponent(token)}`, {
      method: 'DELETE'
    })
  } catch {
    // offline: the link still dies at its expiry (30 min) and once the invoice is in
  }
}

/** The payment's invoice, or null while the server doesn't have it. */
export async function findInvoice(cashMovementId: string): Promise<SupplierInvoice | null> {
  try {
    return await apiFetch<SupplierInvoice>(`/api/supplier-invoices/by-movement/${cashMovementId}`)
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null
    throw e
  }
}

export function listInvoices(from: string, to: string): Promise<SupplierInvoice[]> {
  return apiFetch<SupplierInvoice[]>(`/api/supplier-invoices?from=${from}&to=${to}`)
}

/** Download the invoice file with the session's token. */
export function invoiceBlob(id: string): Promise<Blob> {
  return apiFetchBlob(`/api/supplier-invoices/${id}/file`)
}

/** Download the file with the session's token and hand back a local object URL. */
export async function invoiceObjectUrl(id: string): Promise<string> {
  return URL.createObjectURL(await invoiceBlob(id))
}

/** Friendly message when the till can't reach the server (or has no online session). */
export function invoiceErrorMessage(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401) return 'Sin sesión en el servidor: entra con conexión o súbela más tarde.'
    return e.message
  }
  if (e instanceof TypeError) return 'Sin conexión con el servidor: súbela más tarde.'
  return e instanceof Error ? e.message : 'No se pudo subir la factura.'
}
