import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { Supplier } from '../../shared/types'

export interface MirroredSupplier {
  id: string
  name: string
  active: boolean
  updatedAt: string
}

/** Active suppliers, by name. */
export function listSuppliers(db: DB): Supplier[] {
  return db
    .prepare('SELECT id, name FROM suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all() as Supplier[]
}

export function getSupplier(db: DB, id: string): Supplier | null {
  return (db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(id) as Supplier) ?? null
}

/**
 * The supplier with that name (any case), or a new one added on this till and
 * queued for sync. Must run inside the caller's transaction.
 */
export function findOrCreateSupplier(
  db: DB,
  name: string,
  createdByName: string,
  now: Date
): Supplier {
  const clean = name.trim()
  const existing = db
    .prepare('SELECT id, name FROM suppliers WHERE name = ? COLLATE NOCASE')
    .get(clean) as Supplier | undefined
  if (existing) return existing
  const supplier: Supplier = { id: uuidv7(), name: clean }
  db.prepare('INSERT INTO suppliers (id, name, active, updated_at) VALUES (?, ?, 1, ?)').run(
    supplier.id,
    supplier.name,
    now.toISOString()
  )
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'supplier', ?, 'upsert', ?)`
  ).run(uuidv7(), supplier.id, JSON.stringify({ ...supplier, createdByName }))
  return supplier
}

/**
 * Upsert the backend's suppliers. A local row with the same name but another id
 * (added offline here while someone else added it elsewhere) gives way to the
 * backend's one, and this till's payments are re-pointed to it.
 */
export function upsertSuppliers(db: DB, rows: MirroredSupplier[]): number {
  const txn = db.transaction((): number => {
    const sameName = db.prepare(
      'SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND id <> ?'
    )
    const repoint = db.prepare('UPDATE cash_movements SET supplier_id = ? WHERE supplier_id = ?')
    const remove = db.prepare('DELETE FROM suppliers WHERE id = ?')
    const upsert = db.prepare(
      `INSERT INTO suppliers (id, name, active, updated_at) VALUES (@id, @name, @active, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, active = excluded.active,
         updated_at = excluded.updated_at`
    )
    for (const r of rows) {
      for (const dup of sameName.all(r.name, r.id) as { id: string }[]) {
        repoint.run(r.id, dup.id)
        remove.run(dup.id)
      }
      upsert.run({ id: r.id, name: r.name, active: r.active ? 1 : 0, updatedAt: r.updatedAt })
    }
    return rows.length
  })
  return txn()
}
