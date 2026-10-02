import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from './sales'
import {
  openCashSession,
  acceptCashSession,
  getCurrentCashSession,
  previewSessionArqueo,
  closeCashSession,
  assignMissingShifts
} from './cashSession'
import { upsertAccountingGroups } from '../repositories/accountingGroups'
import { getOpenSessions, insertOpenSession } from '../repositories/cashSessions'
import { DEFAULT_SHIFTS } from '../../shared/shifts'
import type { CloseSessionResult } from '../../shared/types'

let db: DB

// Local wall-clock instants (shifts are local time): Mañana 08–16, Tarde 16–00.
const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute)

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  upsertAccountingGroups(db, [
    { id: 'g1', code: 'BARRA', name: 'Barra', active: true, updatedAt: '2026-01-01T00:00:00.000Z' }
  ])
})

function open(terminalId = 'T01', now = at(1, 9)): string {
  return openCashSession(
    db,
    terminalId,
    { cashierUserId: 'ana', cashierName: 'Ana', openingFloatCents: 15000 },
    DEFAULT_SHIFTS,
    now
  ).id
}

function sell(
  sid: string,
  cents: number,
  opts: { method?: 'cash' | 'card' | 'credit'; seller?: string; client?: string } = {}
): void {
  const method = opts.method ?? 'cash'
  createSale(db, 'T01', {
    items: [
      { productId: 'p1', name: 'P1', quantity: 1, unitPriceCents: cents, accountingGroupId: 'g1' }
    ],
    payment: {
      cashCents: method === 'cash' ? cents : 0,
      cardCents: method === 'card' ? cents : 0,
      creditCents: method === 'credit' ? cents : 0,
      clientId: null,
      clientName: opts.client ?? null
    },
    cashSessionId: sid,
    sellerUserId: opts.seller ?? 'ana',
    sellerName: opts.seller ?? 'ana'
  })
}

function close(
  sid: string,
  now: Date,
  closer = 'ana',
  counted = 15000,
  float = 15000
): CloseSessionResult {
  return closeCashSession(
    db,
    'T01',
    {
      sessionId: sid,
      countedCashCents: counted,
      closingFloatCents: float,
      closedByUserId: closer,
      closedByName: closer
    },
    DEFAULT_SHIFTS,
    now
  )
}

describe('cashSession', () => {
  it('opens the caja of the running shift, with the opener as responsible', () => {
    const sid = open('T01', at(1, 9))
    const current = getCurrentCashSession(db, 'T01')!
    expect(current.id).toBe(sid)
    expect(current.shiftId).toBe('morning')
    expect(current.businessDate).toBe('2026-10-01')
    expect(current.openingFloatCents).toBe(15000)
    expect(current.responsibleName).toBe('Ana')
  })

  it('refuses to open a second caja while one is open (single drawer)', () => {
    open()
    expect(() => open()).toThrow(/ya hay una caja abierta/i)
  })

  it('computes the arqueo with per-seller totals and the fiado list', () => {
    const sid = open()
    sell(sid, 300, { seller: 'ana' })
    sell(sid, 500, { method: 'card', seller: 'luis' })
    sell(sid, 250, { method: 'credit', seller: 'luis', client: 'Familia Müller' })

    const arqueo = previewSessionArqueo(db, sid)
    expect(arqueo.salesCount).toBe(3)
    expect(arqueo.totalCents).toBe(1050)
    expect(arqueo.tenders).toEqual({ cashCents: 300, cardCents: 500, creditCents: 250 })
    expect(arqueo.expectedCashCents).toBe(15300) // 15000 float + 300 cash
    expect(arqueo.sellers).toEqual([
      { userId: 'luis', name: 'luis', salesCount: 2, totalCents: 750 },
      { userId: 'ana', name: 'ana', salesCount: 1, totalCents: 300 }
    ])
    expect(arqueo.fiados).toHaveLength(1)
    expect(arqueo.fiados[0]).toMatchObject({ clientName: 'Familia Müller', amountCents: 250 })
  })

  it('closes with the difference, enqueues a sync row and opens the next shift without responsible', () => {
    const sid = open()
    sell(sid, 300)
    // Counted 15295 vs expected 15300 → 5 short; leaves 150 € for the next shift.
    const { closed, next } = close(sid, at(1, 15), 'ana', 15295, 15000)

    expect(closed.status).toBe('closed')
    expect(closed.expectedCashCents).toBe(15300)
    expect(closed.differenceCents).toBe(-5)
    expect(closed.zNumber).toBe(1)
    expect(closed.closedByName).toBe('ana')
    expect(closed.breakdown[0]).toMatchObject({ code: 'BARRA', totalCents: 300 })

    expect(next.status).toBe('open')
    expect(next.shiftId).toBe('afternoon')
    expect(next.businessDate).toBe('2026-10-01')
    expect(next.openingFloatCents).toBe(15000)
    expect(next.responsibleName).toBeNull()
    expect(getOpenSessions(db, 'T01').map((s) => s.id)).toEqual([next.id])

    // Every state change is synced so the backoffice can show open cajas live:
    // the first caja opened, the cierre, and the handover caja opened by it.
    const ops = db
      .prepare(
        `SELECT entity_id AS id, operation FROM sync_queue
          WHERE entity_type = 'cash_session' ORDER BY rowid`
      )
      .all() as { id: string; operation: string }[]
    expect(ops).toEqual([
      { id: sid, operation: 'open' },
      { id: sid, operation: 'create' },
      { id: next.id, operation: 'open' }
    ])
  })

  it('night cierre: sales after closing Tarde belong to the next morning caja', () => {
    const tarde = open('T01', at(1, 17))
    const { next } = close(tarde, at(1, 23), 'jose')
    expect(next.shiftId).toBe('morning')
    expect(next.businessDate).toBe('2026-10-02')

    sell(next.id, 400, { seller: 'jose' }) // José keeps selling until midnight
    const accepted = acceptCashSession(db, 'T01', {
      sessionId: next.id,
      userId: 'ana',
      userName: 'Ana'
    })
    expect(accepted.responsibleName).toBe('Ana')
    const acceptSync = db
      .prepare(`SELECT payload FROM sync_queue WHERE entity_id = ? AND operation = 'update'`)
      .get(next.id) as { payload: string }
    expect(JSON.parse(acceptSync.payload).responsibleName).toBe('Ana')
    // Ana answers for the float + José's late sales.
    expect(previewSessionArqueo(db, next.id).expectedCashCents).toBe(15400)
  })

  it('a caja closed after midnight hands over to that same morning', () => {
    const tarde = open('T01', at(1, 17))
    const { next } = close(tarde, at(2, 0, 15), 'jose')
    expect(next.shiftId).toBe('morning')
    expect(next.businessDate).toBe('2026-10-02')
  })

  it('double shift: the same person closes Tarde and accepts the next Mañana as a separate caja', () => {
    const tarde = open('T01', at(1, 17))
    const { closed, next } = close(tarde, at(1, 23), 'jose')
    const morning = acceptCashSession(db, 'T01', {
      sessionId: next.id,
      userId: 'jose',
      userName: 'jose'
    })
    expect(morning.id).not.toBe(closed.id)
    expect(morning.responsibleName).toBe('jose')
  })

  it('refuses a second acceptance', () => {
    const { next } = close(open(), at(1, 15))
    acceptCashSession(db, 'T01', { sessionId: next.id, userId: 'pedro', userName: 'Pedro' })
    expect(() =>
      acceptCashSession(db, 'T01', { sessionId: next.id, userId: 'luis', userName: 'Luis' })
    ).toThrow(/ya tiene responsable: Pedro/)
  })

  it('refuses to close a caja nobody has accepted (someone must answer for it)', () => {
    const { next } = close(open(), at(1, 15), 'ana')
    expect(() => close(next.id, at(1, 23), 'pedro')).toThrow(/no tiene responsable/i)
    acceptCashSession(db, 'T01', { sessionId: next.id, userId: 'pedro', userName: 'pedro' })
    expect(close(next.id, at(1, 23), 'pedro').closed.responsibleName).toBe('pedro')
  })

  it('allocates a per-terminal sequential Z number across successive cierres', () => {
    const first = close(open(), at(1, 15))
    acceptCashSession(db, 'T01', { sessionId: first.next.id, userId: 'pedro', userName: 'Pedro' })
    const second = close(first.next.id, at(1, 23))
    expect(first.closed.zNumber).toBe(1)
    expect(second.closed.zNumber).toBe(2)
    // The sequence is scoped per terminal.
    const other = closeCashSession(
      db,
      'T02',
      {
        sessionId: open('T02'),
        countedCashCents: 0,
        closingFloatCents: 0,
        closedByUserId: 'u9',
        closedByName: 'u9'
      },
      DEFAULT_SHIFTS,
      at(1, 15)
    )
    expect(other.closed.zNumber).toBe(1)
  })

  it('refuses to close a caja twice', () => {
    const sid = open()
    close(sid, at(1, 15))
    expect(() => close(sid, at(1, 15))).toThrow(/cerrada/i)
  })

  it('accepting with a different counted float corrects it and logs who did it', () => {
    const { next } = close(open(), at(1, 15), 'ana', 15000, 15000)
    sell(next.id, 300, { seller: 'ana' })
    const accepted = acceptCashSession(
      db,
      'T01',
      { sessionId: next.id, userId: 'pedro', userName: 'Pedro', openingFloatCents: 14000 },
      at(1, 16)
    )
    expect(accepted.openingFloatCents).toBe(14000)
    expect(accepted.floatAdjustments).toEqual([
      {
        at: at(1, 16).toISOString(),
        userId: 'pedro',
        userName: 'Pedro',
        fromCents: 15000,
        toCents: 14000
      }
    ])
    // The expected cash now starts from the corrected float.
    expect(previewSessionArqueo(db, next.id).expectedCashCents).toBe(14300)
  })

  it('accepting with the same float records no correction', () => {
    const { next } = close(open(), at(1, 15))
    const accepted = acceptCashSession(db, 'T01', {
      sessionId: next.id,
      userId: 'pedro',
      userName: 'Pedro',
      openingFloatCents: 15000
    })
    expect(accepted.floatAdjustments).toEqual([])
  })

  it('does not pile up cajas when an old per-cashier caja is still open', () => {
    const first = open()
    // A second open caja left over from the old model (several per terminal).
    insertOpenSession(db, {
      id: 'legacy-2',
      terminalId: 'T01',
      shiftId: null,
      shiftName: null,
      businessDate: null,
      cashierUserId: 'luis',
      cashierName: 'Luis',
      openedAt: at(1, 10).toISOString(),
      openingFloatCents: 10000,
      responsible: null
    })
    const { next } = close(first, at(1, 15))
    expect(next.id).toBe('legacy-2')
    expect(getOpenSessions(db, 'T01').map((s) => s.id)).toEqual(['legacy-2'])
  })

  it('gives a shift to an open caja opened before shifts existed', () => {
    insertOpenSession(db, {
      id: 'legacy-open',
      terminalId: 'T01',
      shiftId: null,
      shiftName: null,
      businessDate: null,
      cashierUserId: 'ana',
      cashierName: 'Ana',
      openedAt: at(1, 17, 53).toISOString(),
      openingFloatCents: 15000,
      responsible: { userId: 'ana', name: 'Ana' }
    })
    expect(assignMissingShifts(db, 'T01', DEFAULT_SHIFTS)).toBe(1)
    expect(getCurrentCashSession(db, 'T01')).toMatchObject({
      shiftId: 'afternoon',
      shiftName: 'Tarde',
      businessDate: '2026-10-01'
    })
    expect(assignMissingShifts(db, 'T01', DEFAULT_SHIFTS)).toBe(0)
  })
})
