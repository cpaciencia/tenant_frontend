import { apiFetch } from '../http'
import type { AuthProvider, AuthSession, SessionUser } from './types'

interface LoginResponse {
  token: string
  expiresInSeconds: number
  user: SessionUser
  permissions: string[]
}

interface MeResponse {
  user: SessionUser
  permissions: string[]
}

/**
 * Online auth provider: authenticates against the cloud backend (JWT). Used by
 * the web backoffice and by the desktop app when it has connectivity. Token
 * persistence is handled by the auth store (it owns where the token is kept).
 */
export function createHttpAuthProvider(): AuthProvider {
  return {
    async login(username, password): Promise<AuthSession> {
      const r = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      return { user: r.user, permissions: r.permissions, token: r.token }
    },
    async restore(): Promise<AuthSession | null> {
      try {
        const r = await apiFetch<MeResponse>('/api/auth/me')
        return { user: r.user, permissions: r.permissions }
      } catch {
        return null
      }
    }
  }
}
