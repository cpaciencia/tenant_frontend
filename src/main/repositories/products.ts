import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { Product } from '../../shared/types'

interface ProductRow {
  id: string
  barcode: string | null
  name: string
  price_cents: number
  tax_rate: number
  active: number
  category_id: string | null
  stock: number
}

const SELECT_COLUMNS = 'id, barcode, name, price_cents, tax_rate, active, category_id, stock'

function mapRow(row: ProductRow): Product {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    priceCents: row.price_cents,
    taxRate: row.tax_rate,
    active: row.active === 1,
    categoryId: row.category_id,
    stock: row.stock
  }
}

export function listProducts(db: DB): Product[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM products WHERE active = 1 ORDER BY name`)
    .all() as ProductRow[]
  return rows.map(mapRow)
}

export function getProductByBarcode(db: DB, barcode: string): Product | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM products WHERE barcode = ?`)
    .get(barcode) as ProductRow | undefined
  return row ? mapRow(row) : null
}

export interface UpsertProductInput {
  barcode: string | null
  name: string
  priceCents: number
  taxRate?: number
  legacyId?: string | null
}

/**
 * Insert-or-update products keyed by barcode. Used by the legacy catalog import
 * and dev seeding. Runs in a single transaction. A new UUIDv7 is generated only
 * for inserts; on conflict the existing row keeps its id.
 */
export function upsertProducts(db: DB, products: UpsertProductInput[]): number {
  const stmt = db.prepare(`
    INSERT INTO products (id, barcode, name, price_cents, tax_rate, legacy_id, updated_at)
    VALUES (@id, @barcode, @name, @priceCents, @taxRate, @legacyId, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(barcode) DO UPDATE SET
      name        = excluded.name,
      price_cents = excluded.price_cents,
      tax_rate    = excluded.tax_rate,
      legacy_id   = excluded.legacy_id,
      updated_at  = excluded.updated_at
  `)
  const txn = db.transaction((items: UpsertProductInput[]) => {
    for (const p of items) {
      stmt.run({
        id: uuidv7(),
        barcode: p.barcode,
        name: p.name,
        priceCents: p.priceCents,
        taxRate: p.taxRate ?? 0,
        legacyId: p.legacyId ?? null
      })
    }
    return items.length
  })
  return txn(products)
}

export function countProducts(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }
  return row.n
}

/** A product as mirrored from the backend down-sync (keyed by id, not barcode). */
export interface MirroredProduct {
  id: string
  barcode: string | null
  name: string
  priceCents: number
  taxRate: number
  active: boolean
  categoryId: string | null
  stock: number
  updatedAt: string
}

/** Highest `updated_at` seen, for incremental product pulls. Null when empty. */
export function getProductsWatermark(db: DB): string | null {
  const row = db.prepare('SELECT MAX(updated_at) AS w FROM products').get() as { w: string | null }
  return row.w ?? null
}

/**
 * Insert-or-update products by id from the backend mirror, in one transaction.
 * Distinct from {@link upsertProducts} (which keys on barcode for the legacy
 * import): the down-sync is authoritative and keyed by the shared UUIDv7 id.
 */
export function upsertMirrorProducts(db: DB, products: MirroredProduct[]): number {
  const stmt = db.prepare(`
    INSERT INTO products (id, barcode, name, price_cents, tax_rate, active, category_id, stock, updated_at)
    VALUES (@id, @barcode, @name, @priceCents, @taxRate, @active, @categoryId, @stock, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      barcode     = excluded.barcode,
      name        = excluded.name,
      price_cents = excluded.price_cents,
      tax_rate    = excluded.tax_rate,
      active      = excluded.active,
      category_id = excluded.category_id,
      stock       = excluded.stock,
      updated_at  = excluded.updated_at
  `)
  const txn = db.transaction((items: MirroredProduct[]) => {
    for (const p of items) {
      stmt.run({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        priceCents: p.priceCents,
        taxRate: p.taxRate,
        active: p.active ? 1 : 0,
        categoryId: p.categoryId,
        stock: p.stock,
        updatedAt: p.updatedAt
      })
    }
    return items.length
  })
  return txn(products)
}
