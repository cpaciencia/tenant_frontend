import { terminalAuthHeaders } from './terminalAuth'
import type { DB } from '../db/connection'
import {
  getAccountingGroupsWatermark,
  upsertAccountingGroups,
  replaceAccountingGroups,
  type MirroredAccountingGroup
} from '../repositories/accountingGroups'

export type FetchLike = typeof fetch

/** Wire shape of GET /api/catalog/accounting-groups (backend AccountingGroupView). */
interface AccountingGroupWire {
  id: string
  code: string
  name: string
  active: boolean
  updatedAt: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Pulls the accounting groups (cajas) into the local mirror (full on first run,
 * incremental via the watermark afterwards). Best-effort. Returns the count upserted.
 */
export async function pullAccountingGroups(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch,
  opts: { full?: boolean } = {}
): Promise<number> {
  const watermark = opts.full ? null : getAccountingGroupsWatermark(db)
  const query = watermark ? `?since=${encodeURIComponent(watermark)}` : ''
  const res = await fetchFn(`${normalizeBase(baseUrl)}/api/catalog/accounting-groups${query}`, {
    method: 'GET',
    headers: terminalAuthHeaders(),
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) {
    throw new Error(`Accounting-group down-sync failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as AccountingGroupWire[]
  const mapped: MirroredAccountingGroup[] = body.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    active: g.active,
    updatedAt: g.updatedAt
  }))
  return opts.full ? replaceAccountingGroups(db, mapped) : upsertAccountingGroups(db, mapped)
}
