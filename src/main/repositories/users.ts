import type { DB } from '../db/connection'

/** A user as mirrored locally (pulled from the backend down-sync). */
export interface MirroredUser {
  id: string
  username: string
  passwordHash: string
  fullName: string | null
  role: string
  active: boolean
  permissions: string[]
  updatedAt: string
}

interface UserRow {
  id: string
  username: string
  password_hash: string
  full_name: string | null
  role: string
  active: number
  permissions: string
  updated_at: string
}

function mapRow(row: UserRow): MirroredUser {
  let permissions: string[] = []
  try {
    permissions = JSON.parse(row.permissions) as string[]
  } catch {
    permissions = []
  }
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    role: row.role,
    active: row.active === 1,
    permissions,
    updatedAt: row.updated_at
  }
}

export function findUserByUsername(db: DB, username: string): MirroredUser | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | UserRow
    | undefined
  return row ? mapRow(row) : null
}

/** Highest `updated_at` seen, for incremental pulls. Null when the mirror is empty. */
export function getUsersWatermark(db: DB): string | null {
  const row = db.prepare('SELECT MAX(updated_at) AS w FROM users').get() as { w: string | null }
  return row.w ?? null
}

export function countUsers(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n
}

/** Insert-or-update mirrored users by id, in one transaction. */
export function upsertUsers(db: DB, users: MirroredUser[]): number {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, active, permissions, updated_at)
    VALUES (@id, @username, @passwordHash, @fullName, @role, @active, @permissions, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      username      = excluded.username,
      password_hash = excluded.password_hash,
      full_name     = excluded.full_name,
      role          = excluded.role,
      active        = excluded.active,
      permissions   = excluded.permissions,
      updated_at    = excluded.updated_at
  `)
  const txn = db.transaction((items: MirroredUser[]) => {
    for (const u of items) {
      stmt.run({
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash,
        fullName: u.fullName,
        role: u.role,
        active: u.active ? 1 : 0,
        permissions: JSON.stringify(u.permissions ?? []),
        updatedAt: u.updatedAt
      })
    }
    return items.length
  })
  return txn(users)
}
