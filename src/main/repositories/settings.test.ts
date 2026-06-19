import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { getSettings, updateSettings, sanitizeSettings } from './settings'

let db: DB

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

afterEach(() => {
  delete process.env.TERMINAL_ID
})

describe('settings repository', () => {
  it('returns the defaults on a fresh database (customer display OFF)', () => {
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS)
    expect(getSettings(db).customerDisplayEnabled).toBe(false)
  })

  it('persists a partial update and merges it over the rest', () => {
    const updated = updateSettings(db, { customerDisplayEnabled: true })
    expect(updated.customerDisplayEnabled).toBe(true)
    expect(updated.terminalId).toBe(DEFAULT_SETTINGS.terminalId)
    // Survives a re-read (durable, not just in-memory).
    expect(getSettings(db).customerDisplayEnabled).toBe(true)
  })

  it('seeds terminalId from TERMINAL_ID env until explicitly overridden', () => {
    process.env.TERMINAL_ID = 'T07'
    expect(getSettings(db).terminalId).toBe('T07')
    // An explicit UI choice wins over the env seed.
    updateSettings(db, { terminalId: 'T09' })
    expect(getSettings(db).terminalId).toBe('T09')
  })

  it('ignores unknown and ill-typed fields when sanitizing', () => {
    const dirty = { terminalId: '  T02  ', customerDisplayEnabled: 'yes', bogus: 123 } as unknown
    const clean = sanitizeSettings(dirty as Partial<typeof DEFAULT_SETTINGS>)
    expect(clean).toEqual({ terminalId: 'T02' })
  })

  it('rejects a blank terminalId (keeps the previous value)', () => {
    updateSettings(db, { terminalId: 'T05' })
    const updated = updateSettings(db, { terminalId: '   ' })
    expect(updated.terminalId).toBe('T05')
  })
})