import type { DB } from '../db/connection'
import {
  getCategoriesWatermark,
  upsertCategories,
  replaceCategories,
  type MirroredCategory
} from '../repositories/categories'

export type FetchLike = typeof fetch

/** Wire shape of GET /api/catalog/categories (backend CategorySyncDto). */
interface CategoryWire {
  id: string
  name: string
  parentId: string | null
  accountingGroupId: string
  color: string | null
  icon: string | null
  active: boolean
  updatedAt: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Pulls the central category tree into the local mirror (full on first run,
 * incremental via the stored watermark afterwards). Best-effort: callers tolerate
 * failure and fall back to whatever the mirror already has. Returns the count upserted.
 */
export async function pullCategories(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch,
  opts: { full?: boolean } = {}
): Promise<number> {
  // `full` ignores the watermark and replaces the mirror wholesale — used to clear
  // orphan rows (e.g. duplicates) after the backend was reset/re-imported.
  const watermark = opts.full ? null : getCategoriesWatermark(db)
  const query = watermark ? `?since=${encodeURIComponent(watermark)}` : ''
  const res = await fetchFn(`${normalizeBase(baseUrl)}/api/catalog/categories${query}`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) {
    throw new Error(`Category down-sync failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as CategoryWire[]
  const mapped: MirroredCategory[] = body.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    accountingGroupId: c.accountingGroupId,
    color: c.color,
    icon: c.icon,
    active: c.active,
    updatedAt: c.updatedAt
  }))
  return opts.full ? replaceCategories(db, mapped) : upsertCategories(db, mapped)
}
