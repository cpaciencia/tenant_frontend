import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { closeCashSession, openCashSession, previewSessionArqueo } from './cashSession'
import {
  listInternalAccounts,
  recordInternalConsumption,
  replaceInternalAccounts
} from './internalConsumption'
import { DEFAULT_SHIFTS } from '../../shared/shifts'

let db: DB
let sid: string
const luis = { userId: 'luis', name: 'Luis' }
const lejia = { productId: 'p-lejia', name: 'Lejía 5 L', quantity: 2, unitPriceCents: 350 }

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  replaceInternalAccounts(db, [
    { id: 'acc-limp', name: 'Limpieza', active: true, updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'acc-old', name: 'Antigua', active: false, updatedAt: '2026-10-01T00:00:00Z' }
  ])
  sid = openCashSession(
    db,
    'T01',
    { cashierUserId: 'luis', cashierName: 'Luis', openingFloatCents: 15000 },
    DEFAULT_SHIFTS
  ).id
})

describe('internal consumption', () => {
  it('records goods taken: own numbering, synced, audited, no sale and no money', () => {
    expect(listInternalAccounts(db).map((a) => a.name)).toEqual(['Limpieza'])
    const c = recordInternalConsumption(db, 'T01', {
      items: [lejia],
      accountId: 'acc-limp',
      takenByName: 'Ana',
      reason: 'Baños',
      cashSessionId: sid,
      actor: luis
    })
    expect(c.consumptionNumber).toMatch(/^CI-T01-\d{4}-00001$/)
    expect(c.totalCents).toBe(700)

    const sales = db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }
    expect(sales.n).toBe(0)
    const queued = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type = 'internal_consumption'")
      .get() as { n: number }
    expect(queued.n).toBe(1)
    const audit = db
      .prepare(
        "SELECT data_json AS data FROM audit_events WHERE type = 'internal_consumption.recorded'"
      )
      .get() as { data: string }
    expect(JSON.parse(audit.data)).toMatchObject({ takenByName: 'Ana', accountName: 'Limpieza' })

    const arqueo = previewSessionArqueo(db, sid)
    expect(arqueo.totalCents).toBe(0)
    expect(arqueo.expectedCashCents).toBe(15000)
    expect(arqueo.internalConsumptions).toHaveLength(1)
  })

  it('requires who takes it, an active account and catalog products only', () => {
    const base = { items: [lejia], accountId: 'acc-limp', cashSessionId: sid, actor: luis }
    expect(() => recordInternalConsumption(db, 'T01', { ...base, takenByName: ' ' })).toThrow(
      /quién/
    )
    expect(() =>
      recordInternalConsumption(db, 'T01', { ...base, accountId: 'acc-old', takenByName: 'Ana' })
    ).toThrow(/cuenta/)
    expect(() =>
      recordInternalConsumption(db, 'T01', {
        ...base,
        takenByName: 'Ana',
        items: [{ ...lejia, productId: '' }]
      })
    ).toThrow(/catálogo/)
  })

  it('is sealed into the cierre (informative)', () => {
    recordInternalConsumption(db, 'T01', {
      items: [lejia],
      accountId: 'acc-limp',
      takenByName: 'Ana',
      cashSessionId: sid,
      actor: luis
    })
    const { closed } = closeCashSession(
      db,
      'T01',
      {
        sessionId: sid,
        countedCashCents: 15000,
        closingFloatCents: 15000,
        closedByUserId: 'luis',
        closedByName: 'Luis'
      },
      DEFAULT_SHIFTS
    )
    expect(closed.differenceCents).toBe(0)
    expect(closed.internalConsumptions[0]).toMatchObject({ takenByName: 'Ana', totalCents: 700 })
  })
})
