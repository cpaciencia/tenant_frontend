import bcrypt from 'bcryptjs'
import type { DB } from '../db/connection'
import { findUserByUsername } from '../repositories/users'
import { pullUsers, type FetchLike } from '../sync/userPull'

/** Result of a login: identity + effective permissions, and a JWT when online. */
export interface AuthSessionResult {
  user: { id: string; username: string; fullName: string | null; role: string }
  permissions: string[]
  token?: string | null
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Authenticates a POS user. Tries the backend first (authoritative permissions +
 * a JWT that unlocks online management screens), refreshing the local mirror on
 * success; if the backend is unreachable it falls back to verifying the BCrypt
 * hash against the local mirror — so the till keeps working offline with the
 * SAME effective permissions. Same can() either way.
 */
export class AuthService {
  constructor(
    private readonly db: DB,
    private readonly getBaseUrl: () => string,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  async login(username: string, password: string): Promise<AuthSessionResult> {
    const online = await this.tryOnline(username, password)
    if (online) {
      this.pullSafe()
      return online
    }
    const offline = this.loginOffline(username, password)
    if (!offline) {
      throw new Error('Usuario o contraseña incorrectos')
    }
    return offline
  }

  private async tryOnline(username: string, password: string): Promise<AuthSessionResult | null> {
    try {
      const res = await this.fetchFn(`${normalizeBase(this.getBaseUrl())}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(4000)
      })
      if (res.status === 401) {
        // Backend reachable and rejected the credentials — definitive.
        throw new Error('Usuario o contraseña incorrectos')
      }
      if (!res.ok) return null
      const body = (await res.json()) as {
        token: string
        user: { id: string; username: string; fullName: string | null; role: string }
        permissions: string[]
      }
      return { user: body.user, permissions: body.permissions, token: body.token }
    } catch (e) {
      if (e instanceof Error && e.message === 'Usuario o contraseña incorrectos') throw e
      return null // network/timeout → fall back to offline
    }
  }

  private loginOffline(username: string, password: string): AuthSessionResult | null {
    const user = findUserByUsername(this.db, username)
    if (!user || !user.active) return null
    if (!bcrypt.compareSync(password, user.passwordHash)) return null
    return {
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
      permissions: user.permissions,
      token: null
    }
  }

  private pullSafe(): void {
    pullUsers(this.db, this.getBaseUrl(), this.fetchFn).catch(() => {
      // best-effort mirror refresh; ignore failures
    })
  }
}
