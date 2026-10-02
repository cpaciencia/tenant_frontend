import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from './sales'
import { openCashSession } from './cashSession'
import { DEFAULT_SHIFTS } from '../../shared/shifts'

let db: DB
let sid: string
const year = new Date().getFullYear()

/** Cash payment covering `total` (the common case in these tests). */
function cash(total: number): {
  cashCents: number
  cardCents: number
  creditCents: number
  clientId: null
  clientName: null
} {
  return { cashCents: total, cardCents: 0, creditCents: 0, clientId: null, clientName: null }
}

const seller = { sellerUserId: 'u1', sellerName: 'Cajera' }

/** Open a caja for a terminal and return its id (a sale needs an open caja). */
function openCaja(terminalId: string): string {
  return openCashSession(
    db,
    terminalId,
    { cashierUserId: 'u1', cashierName: 'Cajera', openingFloatCents: 0 },
    DEFAULT_SHIFTS
  ).id
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  sid = openCaja('T01')
})

describe('createSale', () => {
  it('issues sequential, zero-padded ticket numbers and totals correctly', () => {
    const s1 = createSale(db, 'T01', {
      items: [
        { productId: 'p1', name: 'P1', quantity: 2, unitPriceCents: 150, accountingGroupId: 'g1' }
      ],
      payment: cash(300),
      cashSessionId: sid,
      ...seller
    })
    const s2 = createSale(db, 'T01', {
      items: [
        { productId: 'p2', name: 'P2', quantity: 1, unitPriceCents: 999, accountingGroupId: null }
      ],
      payment: cash(999),
      cashSessionId: sid,
      ...seller
    })
    expect(s1.ticketNumber).toBe(`T01-${year}-00001`)
    expect(s2.ticketNumber).toBe(`T01-${year}-00002`)
    expect(s1.totalCents).toBe(300)
    expect(s2.totalCents).toBe(999)
  })

  it('rejects a payment that does not match the total', () => {
    expect(() =>
      createSale(db, 'T01', {
        items: [
          { productId: 'p1', name: 'P1', quantity: 1, unitPriceCents: 500, accountingGroupId: null }
        ],
        payment: cash(400),
        cashSessionId: sid,
        ...seller
      })
    ).toThrow(/does not match/)
  })

  it('rejects a sale with no open caja', () => {
    expect(() =>
      createSale(db, 'T01', {
        items: [],
        payment: cash(0),
        cashSessionId: 'nope',
        ...seller
      })
    ).toThrow(/caja/i)
  })

  it('keeps a separate sequence space per terminal', () => {
    createSale(db, 'T01', { items: [], payment: cash(0), cashSessionId: sid, ...seller })
    const sid2 = openCaja('T02')
    const t2 = createSale(db, 'T02', {
      items: [],
      payment: cash(0),
      cashSessionId: sid2,
      ...seller
    })
    expect(t2.ticketNumber).toBe(`T02-${year}-00001`)
  })

  it('generates UUIDv7 ids', () => {
    const s = createSale(db, 'T01', { items: [], payment: cash(0), cashSessionId: sid, ...seller })
    expect(s.id[14]).toBe('7')
  })

  it('enqueues exactly one pending sync row per sale', () => {
    createSale(db, 'T01', { items: [], payment: cash(0), cashSessionId: sid, ...seller })
    createSale(db, 'T01', { items: [], payment: cash(0), cashSessionId: sid, ...seller })
    // Only sale rows: opening the caja also enqueues its own snapshot.
    const pending = db
      .prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE synced = 0 AND entity_type = 'sale'`)
      .get() as { n: number }
    expect(pending.n).toBe(2)
  })

  it('rejects a duplicate ticket_number via the UNIQUE constraint', () => {
    const s = createSale(db, 'T01', { items: [], payment: cash(0), cashSessionId: sid, ...seller })
    expect(() =>
      db
        .prepare(
          'INSERT INTO sales (id, ticket_number, terminal_id, ticket_year, ticket_sequence) VALUES (?,?,?,?,?)'
        )
        .run('x', s.ticketNumber, 'T01', year, 99)
    ).toThrow()
  })
})
