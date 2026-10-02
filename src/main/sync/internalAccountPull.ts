import type { DB } from '../db/connection'
import { replaceInternalAccounts } from '../services/internalConsumption'
import { terminalAuthHeaders } from './terminalAuth'

export type FetchLike = typeof fetch

/** Pulls the internal accounts (full replace; the backoffice owns them). Best-effort. */
export async function pullInternalAccounts(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch
): Promise<number> {
  const res = await fetchFn(`${baseUrl.trim().replace(/\/+$/, '')}/api/catalog/internal-accounts`, {
    method: 'GET',
    headers: terminalAuthHeaders(),
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`Internal-account down-sync failed (HTTP ${res.status})`)
  return replaceInternalAccounts(
    db,
    (await res.json()) as { id: string; name: string; active: boolean; updatedAt: string }[]
  )
}
