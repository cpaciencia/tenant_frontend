import type { IssuedCredentials } from './client'

/**
 * Persists the issued terminal credentials (sync token + DB key). Abstracted
 * behind an interface so the service can be unit-tested with an in-memory store;
 * the production implementation (`safeStorageStore.ts`) seals the blob with the
 * OS keychain. This module stays free of Electron imports so it's safe to load
 * under Vitest (Node).
 */
export interface CredentialStore {
  load: () => IssuedCredentials | null
  save: (credentials: IssuedCredentials) => void
  clear: () => void
}

export function createInMemoryCredentialStore(): CredentialStore {
  let value: IssuedCredentials | null = null
  return {
    load: () => value,
    save: (c) => {
      value = c
    },
    clear: () => {
      value = null
    }
  }
}