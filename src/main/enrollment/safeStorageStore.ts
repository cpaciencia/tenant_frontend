import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { safeStorage } from 'electron'
import type { IssuedCredentials } from './client'
import type { CredentialStore } from './store'

interface StoredBlob {
  v: 1
  enc: boolean
  payload: string // base64
}

/**
 * File-backed credential store sealed with Electron `safeStorage` (Keychain on
 * macOS, DPAPI on Windows). If OS encryption is unavailable (e.g. a Linux box
 * with no keyring) it falls back to base64-at-rest with a warning — never
 * silently insecure. Imports Electron, so it must not be loaded under Vitest.
 */
export function createSafeStorageCredentialStore(filePath: string): CredentialStore {
  return {
    load() {
      if (!existsSync(filePath)) return null
      try {
        const blob = JSON.parse(readFileSync(filePath, 'utf8')) as StoredBlob
        const buffer = Buffer.from(blob.payload, 'base64')
        const json = blob.enc ? safeStorage.decryptString(buffer) : buffer.toString('utf8')
        return JSON.parse(json) as IssuedCredentials
      } catch {
        return null
      }
    },
    save(credentials) {
      const json = JSON.stringify(credentials)
      const enc = safeStorage.isEncryptionAvailable()
      if (!enc) {
        console.warn('safeStorage unavailable: terminal credentials stored without OS encryption')
      }
      const payload = (enc ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')).toString(
        'base64'
      )
      const blob: StoredBlob = { v: 1, enc, payload }
      writeFileSync(filePath, JSON.stringify(blob), { mode: 0o600 })
    },
    clear() {
      if (existsSync(filePath)) unlinkSync(filePath)
    }
  }
}