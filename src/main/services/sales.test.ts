import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from './sales'

let db: DB
const year = new Date().getFullYear()

/** Cash payment covering `total` (the common case in these tests). */
function cash(total: number): {
  cashCents: number
  cardCents: number
  creditCents: number
  clientId: null
} {
  return { cashCents: total, cardCents: 0, creditCents: 0, clientId: null }
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

describe('createSale', () => {
  it('issues sequential, zero-padded ticket numbers and totals correctly', () => {
    const s1 = createSale(db, 'T01', {
      items: [{ productId: 'p1', quantity: 2, unitPriceCents: 150, accountingGroupId: 'g1' }],
      payment: cash(300)
    })
    const s2 = createSale(db, 'T01', {
      items: [{ productId: 'p2', quantity: 1, unitPriceCents: 999, accountingGroupId: null }],
      payment: cash(999)
    })
    expect(s1.ticketNumber).toBe(`T01-${year}-00001`)
    expect(s2.ticketNumber).toBe(`T01-${year}-00002`)
    expect(s1.totalCents).toBe(300)
    expect(s2.totalCents).toBe(999)
  })

  it('rejects a payment that does not match the total', () => {
    expect(() =>
      createSale(db, 'T01', {
        items: [{ productId: 'p1', quantity: 1, unitPriceCents: 500, accountingGroupId: null }],
        payment: cash(400)
      })
    ).toThrow(/does not match/)
  })

  it('keeps a separate sequence space per terminal', () => {
    createSale(db, 'T01', { items: [], payment: cash(0) })
    const t2 = createSale(db, 'T02', { items: [], payment: cash(0) })
    expect(t2.ticketNumber).toBe(`T02-${year}-00001`)
  })

  it('generates UUIDv7 ids', () => {
    const s = createSale(db, 'T01', { items: [], payment: cash(0) })
    expect(s.id[14]).toBe('7')
  })

  it('enqueues exactly one pending sync row per sale', () => {
    createSale(db, 'T01', { items: [], payment: cash(0) })
    createSale(db, 'T01', { items: [], payment: cash(0) })
    const pending = db.prepare('SELECT COUNT(*) AS n FROM sync_queue WHERE synced = 0').get() as {
      n: number
    }
    expect(pending.n).toBe(2)
  })

  it('rejects a duplicate ticket_number via the UNIQUE constraint', () => {
    const s = createSale(db, 'T01', { items: [], payment: cash(0) })
    expect(() =>
      db
        .prepare(
          'INSERT INTO sales (id, ticket_number, terminal_id, ticket_year, ticket_sequence) VALUES (?,?,?,?,?)'
        )
        .run('x', s.ticketNumber, 'T01', year, 99)
    ).toThrow()
  })
})
