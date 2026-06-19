import { Umzug } from 'umzug'
import type { DB } from './connection'
import { SqliteStorage } from './storage'
import { migrations } from './migrations'

/**
 * Builds an Umzug instance bound to the given database. The `context` passed to
 * each migration's up/down is the better-sqlite3 connection.
 */
export function createMigrator(db: DB): Umzug<DB> {
  return new Umzug<DB>({
    migrations,
    context: db,
    storage: new SqliteStorage(db),
    logger: console
  })
}

/** Applies all pending migrations. Safe to call on every app start. */
export async function runMigrations(db: DB): Promise<void> {
  await createMigrator(db).up()
}
