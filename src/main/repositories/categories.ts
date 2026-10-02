import type { DB } from '../db/connection'
import type { Category } from '../../shared/types'

/** A category as mirrored locally (pulled from the backend down-sync). */
export interface MirroredCategory extends Category {
  updatedAt: string
}

interface CategoryRow {
  id: string
  name: string
  parent_id: string | null
  accounting_group_id: string
  color: string | null
  icon: string | null
  active: number
}

function mapRow(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    accountingGroupId: row.accounting_group_id,
    color: row.color,
    icon: row.icon,
    active: row.active === 1
  }
}

/** Active categories for the POS, ordered by name. */
export function listCategories(db: DB): Category[] {
  const rows = db
    .prepare(
      'SELECT id, name, parent_id, accounting_group_id, color, icon, active FROM categories WHERE active = 1 ORDER BY name'
    )
    .all() as CategoryRow[]
  return rows.map(mapRow)
}

/** Highest `updated_at` seen, for incremental pulls. Null when the mirror is empty. */
export function getCategoriesWatermark(db: DB): string | null {
  const row = db.prepare('SELECT MAX(updated_at) AS w FROM categories').get() as {
    w: string | null
  }
  return row.w ?? null
}

export function countCategories(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }
  return row.n
}

/** Insert-or-update mirrored categories by id, in one transaction. */
export function upsertCategories(db: DB, categories: MirroredCategory[]): number {
  const stmt = db.prepare(`
    INSERT INTO categories (id, name, parent_id, accounting_group_id, color, icon, active, updated_at)
    VALUES (@id, @name, @parentId, @accountingGroupId, @color, @icon, @active, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name                = excluded.name,
      parent_id           = excluded.parent_id,
      accounting_group_id = excluded.accounting_group_id,
      color               = excluded.color,
      icon                = excluded.icon,
      active              = excluded.active,
      updated_at          = excluded.updated_at
  `)
  const txn = db.transaction((items: MirroredCategory[]) => {
    for (const c of items) {
      stmt.run({
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        accountingGroupId: c.accountingGroupId,
        color: c.color,
        icon: c.icon,
        active: c.active ? 1 : 0,
        updatedAt: c.updatedAt
      })
    }
    return items.length
  })
  return txn(categories)
}

/**
 * Replaces the whole category mirror with the given authoritative set, atomically.
 * Use after the backend was reset/re-imported: a plain upsert leaves orphan rows
 * (old ids) behind, which surface as duplicates in the POS grid. The delete + insert
 * run in one transaction so the mirror is never empty mid-way.
 */
export function replaceCategories(db: DB, categories: MirroredCategory[]): number {
  const txn = db.transaction((items: MirroredCategory[]) => {
    db.prepare('DELETE FROM categories').run()
    upsertCategories(db, items)
    return items.length
  })
  return txn(categories)
}
