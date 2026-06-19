import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * Pre-enrolment configuration that must be readable BEFORE the encrypted database
 * can be opened — chiefly the backend URL the setup screen and enrolment need.
 * Lives in a small plaintext file outside the encrypted DB (it isn't sensitive).
 * Abstracted behind an interface so the enrolment service is testable in memory.
 */
export interface BootstrapConfig {
  getSyncApiUrl: () => string
  setSyncApiUrl: (url: string) => void
}

const DEFAULT_SYNC_API_URL = 'http://localhost:8080'

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function envDefaultUrl(): string {
  const fromEnv = process.env.SYNC_API_URL?.trim()
  return fromEnv ? normalize(fromEnv) : DEFAULT_SYNC_API_URL
}

export function createInMemoryBootstrapConfig(initial?: string): BootstrapConfig {
  let syncApiUrl = initial ? normalize(initial) : envDefaultUrl()
  return {
    getSyncApiUrl: () => syncApiUrl,
    setSyncApiUrl: (url) => {
      syncApiUrl = normalize(url)
    }
  }
}

interface BootstrapFile {
  syncApiUrl?: string
}

/** File-backed bootstrap config (plaintext JSON in userData). */
export function createFileBootstrapConfig(filePath: string): BootstrapConfig {
  function read(): BootstrapFile {
    if (!existsSync(filePath)) return {}
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as BootstrapFile
    } catch {
      return {}
    }
  }
  return {
    getSyncApiUrl: () => {
      const stored = read().syncApiUrl?.trim()
      return stored ? normalize(stored) : envDefaultUrl()
    },
    setSyncApiUrl: (url) => {
      writeFileSync(filePath, JSON.stringify({ ...read(), syncApiUrl: normalize(url) }))
    }
  }
}