import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { closeCashSession, openCashSession, previewSessionArqueo } from './cashSession'
import { createSale } from './sales'
import { settleDebt } from './accountPayments'
import {
  createClient,
  getClient,
  localClientMovements,
  upsertClients
} from '../repositories/clients'
import { DEFAULT_SHIFTS } from '../../shared/shifts'
import type { CreateSaleRequest, Sale } from '../../shared/types'

let db: DB
let sid: string
const ana = { userId: 'ana', name: 'Ana' }

function sale(
  totalCents: number,
  payment: Partial<CreateSaleRequest['payment']>,
  extra: Partial<CreateSaleRequest> = {}
): Sale {
  return createSale(db, 'T01', {
    items: [
      {
        productId: 'p',
        name: 'Cerveza',
        quantity: 1,
        unitPriceCents: totalCents,
        accountingGroupId: null
      }
    ],
    payment: {
      cashCents: 0,
      cardCents: 0,
      creditCents: 0,
      clientId: null,
      clientName: null,
      ...payment
    },
    cashSessionId: sid,
    sellerUserId: 'ana',
    sellerName: 'Ana',
    ...extra
  })
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  sid = openCashSession(
    db,
    'T01',
    { cashierUserId: 'ana', cashierName: 'Ana', openingFloatCents: 15000 },
    DEFAULT_SHIFTS
  ).id
})

describe('"a cuenta" clients and debt payments', () => {
  it('a credit sale needs a real client and raises its balance', () => {
    expect(() => sale(500, { creditCents: 500, clientName: 'Alguien' })).toThrow(/cliente/)
    const c = createClient(db, 'T01', { name: 'Familia Müller', detail: 'Parcela 14', actor: ana })
    sale(500, { creditCents: 500, clientId: c.id })
    expect(getClient(db, c.id)!.balanceCents).toBe(500)
    const queued = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type = 'client'")
      .get() as { n: number }
    expect(queued.n).toBe(1)
  })

  it('adds what the client owes on other terminals (from the server)', () => {
    upsertClients(db, [
      {
        id: 'srv-1',
        name: 'Jean Dupont',
        detail: null,
        phone: null,
        active: true,
        updatedAt: '2026-10-01T00:00:00Z',
        balanceOtherTerminalsCents: 1200
      }
    ])
    sale(300, { creditCents: 300, clientId: 'srv-1' })
    expect(getClient(db, 'srv-1')!.balanceCents).toBe(1500)
  })

  it('a client pays part of the debt in cash: into the caja, not a sale', () => {
    const c = createClient(db, 'T01', { name: 'García', actor: ana })
    sale(2000, { creditCents: 2000, clientId: c.id })
    const p = settleDebt(db, 'T01', { clientId: c.id, cashCents: 1500, cardCents: 0, actor: ana })
    expect(p.paymentNumber).toBe(
      'CC-T01-2026-00001'.replace('2026', String(new Date().getFullYear()))
    )
    expect(getClient(db, c.id)!.balanceCents).toBe(500)

    const arqueo = previewSessionArqueo(db, sid)
    expect(arqueo.totalCents).toBe(2000) // only the credit sale is a sale
    expect(arqueo.settlements).toMatchObject({ cashCents: 1500, cardCents: 0, totalCents: 1500 })
    expect(arqueo.expectedCashCents).toBe(15000 + 1500)
    expect(localClientMovements(db, c.id).map((m) => m.kind)).toEqual(['payment', 'credit_sale'])
  })

  it('never takes more than the client owes', () => {
    const c = createClient(db, 'T01', { name: 'Rossi', actor: ana })
    sale(1000, { creditCents: 1000, clientId: c.id })
    expect(() =>
      settleDebt(db, 'T01', { clientId: c.id, cashCents: 1001, cardCents: 0, actor: ana })
    ).toThrow(/mayor que lo que debe/)
    expect(() =>
      settleDebt(db, 'T01', { clientId: c.id, cashCents: 0, cardCents: 0, actor: ana })
    ).toThrow(/mayor que 0/)
  })

  it('pays the debt together with a new purchase in one go', () => {
    const c = createClient(db, 'T01', { name: 'Smith', actor: ana })
    sale(800, { creditCents: 800, clientId: c.id })
    const s = sale(
      300,
      { cashCents: 300 },
      { settlement: { clientId: c.id, cashCents: 500, cardCents: 300 } }
    )
    expect(s.settlement?.totalCents).toBe(800)
    expect(s.settlement?.saleId).toBe(s.id)
    expect(getClient(db, c.id)!.balanceCents).toBe(0)
    // Not on a credit sale.
    expect(() =>
      sale(
        100,
        { creditCents: 100, clientId: c.id },
        {
          settlement: { clientId: c.id, cashCents: 1, cardCents: 0 }
        }
      )
    ).toThrow(/a cuenta/)
  })

  it('seals the debt payments into the cierre', () => {
    const c = createClient(db, 'T01', { name: 'Lopez', actor: ana })
    sale(1000, { creditCents: 1000, clientId: c.id })
    settleDebt(db, 'T01', { clientId: c.id, cashCents: 400, cardCents: 600, actor: ana })
    const { closed } = closeCashSession(
      db,
      'T01',
      {
        sessionId: sid,
        countedCashCents: 15400,
        closingFloatCents: 15000,
        closedByUserId: 'ana',
        closedByName: 'Ana'
      },
      DEFAULT_SHIFTS
    )
    expect(closed.expectedCashCents).toBe(15400)
    expect(closed.differenceCents).toBe(0)
    expect(closed.settlements).toHaveLength(1)
    expect(closed.settlements[0]).toMatchObject({
      clientName: 'Lopez',
      cashCents: 400,
      cardCents: 600
    })
  })
})
