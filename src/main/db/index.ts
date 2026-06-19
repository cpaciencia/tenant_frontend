import { join } from 'path'
import { app } from 'electron'
import { createDatabase, type DB } from './connection'
import { runMigrations } from './migrator'

let db: DB | undefined

/**
 * Opens the encrypted local database under Electron's per-user data directory and
 * applies pending migrations. The `key` is the per-terminal DB key issued at
 * enrolment — the database cannot be opened without it, so this only runs once
 * the terminal is enrolled. Idempotent — safe to await once after enrolment.
 */
export async function initDatabase(key: string): Promise<DB> {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'camping-pos.db')
  const connection = createDatabase(dbPath, key)
  await runMigrations(connection)
  db = connection
  return db
}

/** Returns the open database, or throws if initDatabase() hasn't run yet. */
export function getDatabase(): DB {
  if (!db) throw new Error('Database not initialised. Call initDatabase() first.')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = undefined
}

export type { DB }
