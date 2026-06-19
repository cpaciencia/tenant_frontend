import type { DB } from '../db/connection'
import {
  getProductsWatermark,
  upsertMirrorProducts,
  type MirroredProduct
} from '../repositories/products'

export type FetchLike = typeof fetch

/** Wire shape of GET /api/catalog/products (backend ProductSyncDto). */
interface ProductWire {
  id: string
  barcode: string | null
  name: string
  priceCents: number
  taxRate: number
  categoryId: string | null
  active: boolean
  stock: number
  updatedAt: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Pulls the central product catalog into the local mirror (full on first run,
 * incremental via the stored watermark afterwards). Best-effort. Returns the
 * number of products upserted.
 */
export async function pullProducts(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch
): Promise<number> {
  const watermark = getProductsWatermark(db)
  const query = watermark ? `?since=${encodeURIComponent(watermark)}` : ''
  const res = await fetchFn(`${normalizeBase(baseUrl)}/api/catalog/products${query}`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) {
    throw new Error(`Product down-sync failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as ProductWire[]
  const mapped: MirroredProduct[] = body.map((p) => ({
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    priceCents: p.priceCents,
    taxRate: p.taxRate,
    active: p.active,
    categoryId: p.categoryId,
    stock: p.stock ?? 0,
    updatedAt: p.updatedAt
  }))
  return upsertMirrorProducts(db, mapped)
}
