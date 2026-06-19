import type { DB } from '../db/connection'
import { getUsersWatermark, upsertUsers, type MirroredUser } from '../repositories/users'

export type FetchLike = typeof fetch

/** Wire shape of GET /api/users (backend UserDto). */
interface UserDtoWire {
  id: string
  username: string
  passwordHash: string
  fullName: string | null
  role: string
  active: boolean
  permissions: string[]
  updatedAt: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Pulls the central user directory into the local mirror (full on first run,
 * incremental via the stored watermark afterwards). Best-effort: callers should
 * tolerate failure (no network) and fall back to whatever the mirror already has.
 * Returns the number of users upserted.
 */
export async function pullUsers(db: DB, baseUrl: string, fetchFn: FetchLike = fetch): Promise<number> {
  const watermark = getUsersWatermark(db)
  const query = watermark ? `?since=${encodeURIComponent(watermark)}` : ''
  const res = await fetchFn(`${normalizeBase(baseUrl)}/api/users${query}`, {
    method: 'GET',
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) {
    throw new Error(`User down-sync failed (HTTP ${res.status})`)
  }
  const body = (await res.json()) as UserDtoWire[]
  const mapped: MirroredUser[] = body.map((u) => ({
    id: u.id,
    username: u.username,
    passwordHash: u.passwordHash,
    fullName: u.fullName,
    role: u.role,
    active: u.active,
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    updatedAt: u.updatedAt
  }))
  return upsertUsers(db, mapped)
}
