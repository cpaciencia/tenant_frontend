import type { DB } from '../db/connection'
import { upsertClients, type MirroredClient } from '../repositories/clients'
import { terminalAuthHeaders } from './terminalAuth'

export type FetchLike = typeof fetch

/**
 * Pulls the "a cuenta" clients with what each owes on OTHER terminals (the server
 * leaves this till out; it adds its own local movements). Upserts only, so a
 * client added offline here is kept. Best-effort.
 */
export async function pullClients(
  db: DB,
  baseUrl: string,
  fetchFn: FetchLike = fetch
): Promise<number> {
  const res = await fetchFn(`${baseUrl.trim().replace(/\/+$/, '')}/api/catalog/clients`, {
    method: 'GET',
    headers: terminalAuthHeaders(),
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`Client down-sync failed (HTTP ${res.status})`)
  return upsertClients(db, (await res.json()) as MirroredClient[])
}
