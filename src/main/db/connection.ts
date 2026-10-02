import Database from 'better-sqlite3-multiple-ciphers'

export type DB = Database.Database

/**
 * Opens (or creates) the local SQLite database and applies the pragmas the
 * offline-first POS relies on:
 * - key: encrypts the file at rest (SQLCipher-compatible). MUST be the first
 *   statement, before any read/write. Omit it (tests, ':memory:') for a plain DB.
 * - WAL: concurrent reads while a write is in progress, fewer fsyncs.
 * - foreign_keys: enforce relational integrity locally.
 * - busy_timeout: wait instead of throwing if the file is briefly locked.
 *
 * The encryption key is issued by the backend at enrolment and cached in the OS
 * keychain — so a copied .db file is useless without an enrolled machine.
 */
export function createDatabase(filename: string, key?: string): DB {
  const db = new Database(filename)
  if (key) {
    // Single quotes are the SQL string delimiter; the key is base64 (no quotes),
    // but escape defensively anyway.
    db.pragma(`key = '${key.replace(/'/g, "''")}'`)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}
