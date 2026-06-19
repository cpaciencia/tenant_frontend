import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuthProvider, AuthSession, SessionUser } from '../services/auth/types'

/**
 * Canonical session + authorization store, shared by web and POS. UI checks
 * capabilities with `can()`; it never inspects roles directly. The session is
 * obtained through a target-supplied {@link AuthProvider} (HTTP for web, IPC for
 * the offline POS) registered via {@link setAuthProvider} at bootstrap.
 */

let provider: AuthProvider | null = null
export function setAuthProvider(p: AuthProvider): void {
  provider = p
}

const SESSION_KEY = 'camping.auth.session'

interface StoredSession {
  user: SessionUser | null
  permissions: string[]
  token: string | null
}

function readStoredSession(): StoredSession | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStoredSession(session: StoredSession | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // storage unavailable — session simply won't survive a reload
  }
}

/** Decode a JWT's `exp` (ms epoch), or null if it can't be read. */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/** A token is usable if it exists and its `exp` is in the future. */
function isTokenValid(token: string | null): boolean {
  if (!token) return false
  const exp = jwtExpiryMs(token)
  return exp !== null && exp > Date.now()
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null)
  const permissions = ref<string[]>([])
  const token = ref<string | null>(null)
  // True once an initial restore() attempt has finished (so guards can wait).
  const ready = ref(false)

  const isAuthenticated = computed(() => user.value !== null)

  function can(permission: string): boolean {
    return permissions.value.includes(permission)
  }
  function canAny(perms: string[]): boolean {
    return perms.some((p) => permissions.value.includes(p))
  }
  function canAll(perms: string[]): boolean {
    return perms.every((p) => permissions.value.includes(p))
  }

  function apply(session: AuthSession): void {
    user.value = session.user
    permissions.value = session.permissions
    if (session.token !== undefined) {
      token.value = session.token ?? null
    }
    // Persist the whole session so it survives a reload/restart (offline-first):
    // restore() trusts it as long as the token hasn't expired.
    writeStoredSession({ user: user.value, permissions: permissions.value, token: token.value })
  }

  function clear(): void {
    user.value = null
    permissions.value = []
    token.value = null
    writeStoredSession(null)
  }

  async function login(username: string, password: string): Promise<void> {
    if (!provider) throw new Error('Auth provider not configured')
    apply(await provider.login(username, password))
  }

  async function logout(): Promise<void> {
    await provider?.logout?.()
    clear()
  }

  /**
   * One-shot session restore on boot. Offline-first: a persisted session with a
   * still-valid (non-expired) token is trusted immediately, so a restart goes
   * straight to the till and the backoffice without re-login. An expired/missing
   * token clears the session (→ login). When a provider can revalidate online
   * (web `/me`), it refines the session; offline we keep the persisted one.
   */
  async function restore(): Promise<void> {
    try {
      const stored = readStoredSession()
      if (stored && stored.user && isTokenValid(stored.token)) {
        apply({ user: stored.user, permissions: stored.permissions, token: stored.token })
      } else if (stored) {
        clear()
      }
      if (provider?.restore) {
        try {
          const session = await provider.restore()
          if (session) apply(session)
          else if (!isAuthenticated.value) clear()
        } catch {
          // Offline / backend unreachable — keep the optimistic persisted session.
        }
      }
    } finally {
      ready.value = true
    }
  }

  return {
    user,
    permissions,
    token,
    ready,
    isAuthenticated,
    can,
    canAny,
    canAll,
    login,
    logout,
    restore
  }
})
