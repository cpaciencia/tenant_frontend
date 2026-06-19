/**
 * Auth contracts shared by web and POS. The UI and the `auth` store depend ONLY
 * on these — never on how the session is obtained. A target supplies an
 * AuthProvider: web logs in over HTTP (JWT); the POS logs in offline against the
 * local mirror. Same `can()`, different source.
 */

export interface SessionUser {
  id: string
  username: string
  fullName?: string | null
  role: string
}

export interface AuthSession {
  user: SessionUser
  permissions: string[]
  /** Present for online (JWT) sessions; absent for offline POS sessions. */
  token?: string | null
}

export interface AuthProvider {
  login(username: string, password: string): Promise<AuthSession>
  /** Restore a previous session on boot (e.g. from a stored token). */
  restore?(): Promise<AuthSession | null>
  logout?(): Promise<void> | void
}
