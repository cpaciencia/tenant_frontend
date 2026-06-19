import type { UmzugStorage, MigrationParams } from 'umzug'
import type { DB } from './connection'

/**
 * Umzug storage backed by better-sqlite3. Tracks which migrations have run in a
 * `migrations` table so `up()` is idempotent across app restarts.
 */
export class SqliteStorage implements UmzugStorage<DB> {
  constructor(private readonly db: DB) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS migrations (
         name        TEXT PRIMARY KEY,
         executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`
    )
  }

  async logMigration({ name }: MigrationParams<DB>): Promise<void> {
    this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name)
  }

  async unlogMigration({ name }: MigrationParams<DB>): Promise<void> {
    this.db.prepare('DELETE FROM migrations WHERE name = ?').run(name)
  }

  async executed(): Promise<string[]> {
    const rows = this.db.prepare('SELECT name FROM migrations ORDER BY name').all() as {
      name: string
    }[]
    return rows.map((r) => r.name)
  }
}
