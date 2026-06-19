import { describe, it, expect } from 'vitest'
import { createDatabase } from './connection'
import { runMigrations } from './migrator'

describe('migrations', () => {
  it('creates the expected tables', async () => {
    const db = createDatabase(':memory:')
    await runMigrations(db)
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name)
    expect(tables).toEqual(
      expect.arrayContaining(['products', 'sales', 'sync_queue', 'settings', 'migrations'])
    )
    db.close()
  })

  it('is idempotent across repeated runs', async () => {
    const db = createDatabase(':memory:')
    await runMigrations(db)
    const countMigrations = (): number =>
      (db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number }).n
    const afterFirstRun = countMigrations()
    await expect(runMigrations(db)).resolves.not.toThrow()
    // A second run applies nothing new.
    expect(countMigrations()).toBe(afterFirstRun)
    db.close()
  })
})
