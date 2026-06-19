import type { AuthProvider, AuthSession } from './types'

/**
 * Offline-first auth provider for the desktop POS. Delegates to the Main process
 * over IPC, which verifies the BCrypt hash against the local user mirror (and
 * fetches a JWT when the backend is reachable). No `restore`: a till re-logs in
 * each launch rather than persisting a session.
 */
export function createIpcAuthProvider(): AuthProvider {
  return {
    async login(username, password): Promise<AuthSession> {
      const r = await window.api.auth.login(username, password)
      return { user: r.user, permissions: r.permissions, token: r.token ?? null }
    }
  }
}
