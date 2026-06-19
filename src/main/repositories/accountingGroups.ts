import type { DB } from '../db/connection'

/** A "caja por categoría" as mirrored locally (pulled from the backend down-sync). */
export interface MirroredAccountingGroup {
  id: string
  code: string
  name: string
  active: boolean
  updatedAt: string
}

/** An accounting group resolved for display (no sync metadata). */
export interface AccountingGroupRef {
  id: string
  code: string
  name: string
  active: boolean
}

interface AccountingGroupRow {
  id: string
  code: string
  name: string
  active: number
}

function mapRow(row: AccountingGroupRow): AccountingGroupRef {
  return { id: row.id, code: row.code, name: row.name, active: row.active === 1 }
}

/** All accounting groups, ordered by code (used to label the Z-report buckets). */
export function listAccountingGroups(db: DB): AccountingGroupRef[] {
  const rows = db
    .prepare('SELECT id, code, name, active FROM accounting_groups ORDER BY code')
    .all() as AccountingGroupRow[]
  return rows.map(mapRow)
}

/** Highest `updated_at` seen, for incremental pulls. Null when the mirror is empty. */
export function getAccountingGroupsWatermark(db: DB): string | null {
  const row = db.prepare('SELECT MAX(updated_at) AS w FROM accounting_groups').get() as {
    w: string | null
  }
  return row.w ?? null
}

export function countAccountingGroups(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounting_groups').get() as { n: number }
  return row.n
}

/** Insert-or-update mirrored accounting groups by id, in one transaction. */
export function upsertAccountingGroups(db: DB, groups: MirroredAccountingGroup[]): number {
  const stmt = db.prepare(`
    INSERT INTO accounting_groups (id, code, name, active, updated_at)
    VALUES (@id, @code, @name, @active, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      code       = excluded.code,
      name       = excluded.name,
      active     = excluded.active,
      updated_at = excluded.updated_at
  `)
  const txn = db.transaction((items: MirroredAccountingGroup[]) => {
    for (const g of items) {
      stmt.run({
        id: g.id,
        code: g.code,
        name: g.name,
        active: g.active ? 1 : 0,
        updatedAt: g.updatedAt
      })
    }
    return items.length
  })
  return txn(groups)
}
