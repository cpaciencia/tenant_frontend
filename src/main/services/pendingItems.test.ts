import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from './sales'
import { openCashSession } from './cashSession'
import { completePendingItem, dismissPendingItem, listPendingItems } from './pendingItems'
import { DEFAULT_SHIFTS } from '../../shared/shifts'
import type { CartItemInput } from '../../shared/types'

let db: DB
let sid: string
const ana = { userId: 'ana', name: 'Ana' }

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  sid = openCashSession(
    db,
    'T01',
    { cashierUserId: 'ana', cashierName: 'Ana', openingFloatCents: 0 },
    DEFAULT_SHIFTS
  ).id
})

function sell(items: CartItemInput[]): string {
  const total = items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0)
  return createSale(db, 'T01', {
    items,
    payment: { cashCents: total, cardCents: 0, creditCents: 0, clientId: null, clientName: null },
    cashSessionId: sid,
    sellerUserId: 'ana',
    sellerName: 'Ana'
  }).id
}

const quick: CartItemInput = {
  productId: null,
  name: 'Sin identificar',
  quantity: 2,
  unitPriceCents: 150,
  accountingGroupId: 'g-tienda',
  manual: { kind: 'quick', barcode: null, name: null, categoryId: 'c-tienda' }
}
const notFound: CartItemInput = {
  productId: null,
  name: 'Crema solar',
  quantity: 1,
  unitPriceCents: 899,
  accountingGroupId: 'g-tienda',
  manual: { kind: 'not_found', barcode: '8410000000001', name: 'Crema solar', categoryId: null }
}
const known: CartItemInput = {
  productId: 'p1',
  name: 'Pan',
  quantity: 1,
  unitPriceCents: 120,
  accountingGroupId: 'g-tienda'
}

const count = (sql: string, ...args: unknown[]): number =>
  (db.prepare(sql).get(...args) as { n: number }).n

describe('pending items', () => {
  it('creates one pending item per manual line, linked from the stored sale line', () => {
    const saleId = sell([known, quick, notFound])
    const pending = listPendingItems(db)
    expect(pending.map((p) => [p.kind, p.barcode, p.priceCents, p.quantity])).toEqual([
      ['quick', null, 150, 2],
      ['not_found', '8410000000001', 899, 1]
    ])
    expect(pending[0]).toMatchObject({ saleId, createdByName: 'Ana', status: 'pending' })

    const stored = JSON.parse(
      (
        db.prepare('SELECT items_json FROM sales WHERE id = ?').get(saleId) as {
          items_json: string
        }
      ).items_json
    ) as { productId: string | null; pendingItemId?: string }[]
    expect(stored[0].pendingItemId).toBeUndefined()
    expect(stored.slice(1).map((i) => i.pendingItemId)).toEqual(pending.map((p) => p.id))
    expect(stored.slice(1).every((i) => i.productId === null)).toBe(true)
    expect(count(`SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type = 'pending_item'`)).toBe(2)
  })

  it('records the sale in the audit log with its manual line count', () => {
    sell([known, quick])
    const row = db
      .prepare(`SELECT user_name, data_json FROM audit_events WHERE type = 'sale.completed'`)
      .get() as { user_name: string; data_json: string }
    expect(row.user_name).toBe('Ana')
    expect(JSON.parse(row.data_json)).toMatchObject({ lines: 2, manualLines: 1, totalCents: 420 })
  })

  it('completing links the product, leaves the open list and is audited and synced', () => {
    sell([notFound])
    const [item] = listPendingItems(db)
    const done = completePendingItem(db, 'T01', { id: item.id, productId: 'p-new', actor: ana })
    expect(done).toMatchObject({ status: 'completed', productId: 'p-new', resolvedByName: 'Ana' })
    expect(listPendingItems(db)).toHaveLength(0)
    expect(
      count(`SELECT COUNT(*) AS n FROM audit_events WHERE type = 'pending_item.completed'`)
    ).toBe(1)
    expect(
      count(
        `SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type = 'pending_item' AND operation = 'update'`
      )
    ).toBe(1)
  })

  it('dismissing closes it without a product; it cannot be resolved twice', () => {
    sell([quick])
    const [item] = listPendingItems(db)
    expect(dismissPendingItem(db, 'T01', { id: item.id, actor: ana })).toMatchObject({
      status: 'dismissed',
      productId: null
    })
    expect(() =>
      completePendingItem(db, 'T01', { id: item.id, productId: 'p', actor: ana })
    ).toThrow(/ya está resuelto/)
  })
})
