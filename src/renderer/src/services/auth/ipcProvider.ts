import { apiFetch, whenHttpConfigured } from '../http'
import { useAuthStore } from '../../stores/auth'
import type { AuthProvider, AuthSession } from './types'

interface MeResponse {
  user: AuthSession['user']
  permissions: string[]
}

/**
 * Offline-first auth provider for the desktop POS. Delegates login to the Main
 * process over IPC, which verifies the BCrypt hash against the local user mirror
 * (and fetches a JWT when the backend is reachable).
 *
 * `restore` refreshes a persisted session's permissions from the backend (`/me`)
 * when there is a token and the server is reachable, so a permission granted
 * after the last login (e.g. a new feature) shows up without logging in again.
 * Offline it returns null and the persisted session is kept as is.
 */
export function createIpcAuthProvider(): AuthProvider {
  return {
    async login(username, password): Promise<AuthSession> {
      const r = await window.api.auth.login(username, password)
      return { user: r.user, permissions: r.permissions, token: r.token ?? null }
    },
    async restore(): Promise<AuthSession | null> {
      if (!useAuthStore().token) return null
      await whenHttpConfigured()
      try {
        const me = await apiFetch<MeResponse>('/api/auth/me')
        return { user: me.user, permissions: me.permissions }
      } catch {
        return null
      }
    }
  }
}
