import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { seedDevProducts } from '../db/seed'
import {
  listProducts,
  getProductByBarcode,
  upsertProducts,
  countProducts,
  upsertMirrorProducts,
  getProductsWatermark
} from './products'

let db: DB

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

describe('products repository', () => {
  it('seeds the sample catalog exactly once (idempotent)', () => {
    seedDevProducts(db)
    seedDevProducts(db)
    expect(countProducts(db)).toBe(4)
  })

  it('lists active products ordered by name, mapped to camelCase', () => {
    seedDevProducts(db)
    const products = listProducts(db)
    expect(products).toHaveLength(4)
    expect(products.map((p) => p.name)).toEqual([...products.map((p) => p.name)].sort())
    expect(products.every((p) => p.active === true)).toBe(true)
    expect(typeof products[0].priceCents).toBe('number')
  })

  it('finds a product by barcode and returns null when missing', () => {
    seedDevProducts(db)
    expect(getProductByBarcode(db, '8412345000017')?.name).toBe('Agua mineral 1.5L')
    expect(getProductByBarcode(db, 'does-not-exist')).toBeNull()
  })

  it('upserts by barcode: updates the existing row instead of duplicating', () => {
    upsertProducts(db, [{ barcode: 'X1', name: 'Old', priceCents: 100 }])
    const before = getProductByBarcode(db, 'X1')!
    upsertProducts(db, [{ barcode: 'X1', name: 'New', priceCents: 250 }])
    const after = getProductByBarcode(db, 'X1')!

    expect(countProducts(db)).toBe(1)
    expect(after.id).toBe(before.id) // same row, id preserved
    expect(after.name).toBe('New')
    expect(after.priceCents).toBe(250)
  })

  it('mirror upsert keys on id and carries the category link', () => {
    upsertMirrorProducts(db, [
      {
        id: 'p1',
        barcode: 'B1',
        name: 'Agua',
        priceCents: 90,
        taxRate: 0.1,
        active: true,
        categoryId: 'cat-bebidas',
        stock: 10,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    upsertMirrorProducts(db, [
      {
        id: 'p1',
        barcode: 'B1',
        name: 'Agua 1,5L',
        priceCents: 95,
        taxRate: 0.1,
        active: true,
        categoryId: 'cat-aguas',
        stock: 8,
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ])
    const list = listProducts(db)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'p1', name: 'Agua 1,5L', categoryId: 'cat-aguas' })
    expect(getProductsWatermark(db)).toBe('2026-02-01T00:00:00.000Z')
  })
})
