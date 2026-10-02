import type { DB } from '../db/connection'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'
import { sanitizeShifts } from '../../shared/shifts'

const SETTINGS_KEY = 'app'

/**
 * Environment-provided seeds, applied below the stored values so an explicit
 * choice in the UI always wins, but a fresh terminal still honours TERMINAL_ID
 * on first run (keeps the documented env override working).
 */
function envDefaults(): Partial<AppSettings> {
  const terminalId = process.env.TERMINAL_ID?.trim()
  return terminalId ? { terminalId } : {}
}

function parseStored(raw: string): Partial<AppSettings> {
  try {
    const value = JSON.parse(raw)
    return typeof value === 'object' && value !== null ? (value as Partial<AppSettings>) : {}
  } catch {
    return {}
  }
}

/** Coerce an arbitrary partial into a clean, typed settings patch. */
export function sanitizeSettings(patch: Partial<AppSettings>): Partial<AppSettings> {
  const clean: Partial<AppSettings> = {}
  if (typeof patch.terminalId === 'string' && patch.terminalId.trim().length > 0) {
    clean.terminalId = patch.terminalId.trim()
  }
  if (typeof patch.customerDisplayEnabled === 'boolean') {
    clean.customerDisplayEnabled = patch.customerDisplayEnabled
  }
  if (typeof patch.printerEnabled === 'boolean') {
    clean.printerEnabled = patch.printerEnabled
  }
  if (typeof patch.printerName === 'string') {
    clean.printerName = patch.printerName.trim()
  }
  if (typeof patch.businessName === 'string') {
    clean.businessName = patch.businessName.trim()
  }
  if (typeof patch.businessAddress === 'string') {
    clean.businessAddress = patch.businessAddress.trim()
  }
  if (typeof patch.businessTaxId === 'string') {
    clean.businessTaxId = patch.businessTaxId.trim()
  }
  if (typeof patch.businessPhone === 'string') {
    clean.businessPhone = patch.businessPhone.trim()
  }
  if (Number.isFinite(patch.cashFloatCents) && (patch.cashFloatCents as number) >= 0) {
    clean.cashFloatCents = Math.round(patch.cashFloatCents as number)
  }
  if (patch.shifts !== undefined) {
    const shifts = sanitizeShifts(patch.shifts)
    if (shifts) clean.shifts = shifts
  }
  return clean
}

/** Read the merged settings: defaults < env seeds < stored values. */
export function getSettings(db: DB): AppSettings {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SETTINGS_KEY) as
    | { value: string }
    | undefined
  const stored = row ? parseStored(row.value) : {}
  return { ...DEFAULT_SETTINGS, ...envDefaults(), ...stored }
}

/**
 * Make the backend-issued terminal id (from enrolment) the one tickets are
 * numbered with. Enrolment is the authority: without this, a second terminal
 * would keep the "T01" default and issue ticket numbers that collide with the
 * first one's on the backend. The open caja moves along with the id (it is the
 * same physical drawer); past sales and cierres keep the id they were issued with.
 */
export function adoptEnrolledTerminalId(db: DB, terminalId: string): AppSettings {
  const current = getSettings(db)
  const id = terminalId.trim()
  if (!id || current.terminalId === id) return current
  return db.transaction((): AppSettings => {
    db.prepare(
      `UPDATE cash_sessions SET terminal_id = ? WHERE terminal_id = ? AND status = 'open'`
    ).run(id, current.terminalId)
    return updateSettings(db, { terminalId: id })
  })()
}

/**
 * Persist a partial change and return the full merged settings. Only known,
 * well-typed fields are written; anything else in `patch` is ignored.
 */
export function updateSettings(db: DB, patch: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(db), ...sanitizeSettings(patch) }
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(SETTINGS_KEY, JSON.stringify(merged))
  return merged
}
