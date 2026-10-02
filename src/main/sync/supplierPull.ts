import type { DB } from '../db/connection'
import { upsertSuppliers } from '../repositories/suppliers'

export type FetchLike = typeof fetch

/** Wire shape of GET /api/catalog/suppliers (backend SupplierView). */
interface SupplierWire {
  id: string
  name: string
  active: boolean
  updatedAt: string
}

/**
 * Pulls the suppliers into the local mirror. Always upserts (never replaces), so a
 * supplier added offline on this till and not synced yet is kept. Best-effort.
 */
export async function pullSuppliers(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch
): Promise<number> {
  const res = await fetchFn(`${baseUrl.trim().replace(/\/+$/, '')}/api/catalog/suppliers`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`Supplier down-sync failed (HTTP ${res.status})`)
  const body = (await res.json()) as SupplierWire[]
  return upsertSuppliers(
    db,
    body.map((s) => ({ id: s.id, name: s.name, active: s.active, updatedAt: s.updatedAt }))
  )
}
