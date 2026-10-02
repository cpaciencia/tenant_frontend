import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from '../services/sales'
import { openCashSession } from '../services/cashSession'
import { unitsSoldByProduct } from './salesRanking'
import { DEFAULT_SHIFTS } from '../../shared/shifts'
import type { CartItemInput } from '../../shared/types'

let db: DB
let sid: string

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  sid = openCashSession(
    db,
    'T01',
    { cashierUserId: 'u', cashierName: 'U', openingFloatCents: 0 },
    DEFAULT_SHIFTS
  ).id
})

function sell(items: CartItemInput[]): void {
  const total = items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0)
  createSale(db, 'T01', {
    items,
    payment: { cashCents: total, cardCents: 0, creditCents: 0, clientId: null, clientName: null },
    cashSessionId: sid,
    sellerUserId: 'u',
    sellerName: 'U'
  })
}

const line = (productId: string | null, quantity: number): CartItemInput => ({
  productId,
  name: productId ?? 'Rápido',
  quantity,
  unitPriceCents: 100,
  accountingGroupId: null,
  manual: productId ? null : { kind: 'quick', barcode: null, name: null, categoryId: null }
})

describe('unitsSoldByProduct', () => {
  it('sums the units sold per product across sales, ignoring manual lines', () => {
    sell([line('pan', 2), line('leche', 1)])
    sell([line('pan', 3), line(null, 5)])
    expect(unitsSoldByProduct(db)).toEqual({ pan: 5, leche: 1 })
  })

  it('is empty on a terminal without sales', () => {
    expect(unitsSoldByProduct(db)).toEqual({})
  })
})
