import type { DB } from '../db/connection'
import type {
  CashMovement,
  CashSession,
  FiadoEntry,
  FloatAdjustment,
  SellerTotal,
  Tenders,
  ZBreakdownRow,
  AccountPayment
} from '../../shared/types'

interface SessionRow {
  id: string
  terminal_id: string
  shift_id: string | null
  shift_name: string | null
  business_date: string | null
  cashier_user_id: string | null
  cashier_name: string
  opened_at: string
  opening_float_cents: number
  status: string
  responsible_user_id: string | null
  responsible_name: string | null
  accepted_at: string | null
  closed_at: string | null
  closed_by_user_id: string | null
  closed_by_name: string | null
  expected_cash_cents: number | null
  counted_cash_cents: number | null
  difference_cents: number | null
  closing_float_cents: number | null
  z_number: number | null
  sales_count: number
  total_cents: number
  tenders_json: string
  breakdown_json: string
  fiados_json: string
  sellers_json: string
  float_adjustments_json: string
  movements_json: string
  settlements_json: string
}

function parseTenders(json: string): Tenders {
  try {
    const t = JSON.parse(json) as Partial<Tenders>
    return {
      cashCents: t.cashCents ?? 0,
      cardCents: t.cardCents ?? 0,
      creditCents: t.creditCents ?? 0
    }
  } catch {
    return { cashCents: 0, cardCents: 0, creditCents: 0 }
  }
}

function parseList<T>(json: string): T[] {
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

function mapRow(r: SessionRow): CashSession {
  return {
    id: r.id,
    terminalId: r.terminal_id,
    shiftId: r.shift_id,
    shiftName: r.shift_name,
    businessDate: r.business_date,
    cashierUserId: r.cashier_user_id,
    cashierName: r.cashier_name,
    openedAt: r.opened_at,
    openingFloatCents: r.opening_float_cents,
    status: r.status === 'closed' ? 'closed' : 'open',
    responsibleUserId: r.responsible_user_id,
    responsibleName: r.responsible_name,
    acceptedAt: r.accepted_at,
    closedAt: r.closed_at,
    closedByUserId: r.closed_by_user_id,
    closedByName: r.closed_by_name,
    expectedCashCents: r.expected_cash_cents,
    countedCashCents: r.counted_cash_cents,
    differenceCents: r.difference_cents,
    closingFloatCents: r.closing_float_cents,
    zNumber: r.z_number,
    salesCount: r.sales_count,
    totalCents: r.total_cents,
    tenders: parseTenders(r.tenders_json),
    breakdown: parseList<ZBreakdownRow>(r.breakdown_json),
    fiados: parseList<FiadoEntry>(r.fiados_json),
    sellers: parseList<SellerTotal>(r.sellers_json),
    floatAdjustments: parseList<FloatAdjustment>(r.float_adjustments_json),
    cashMovements: parseList<CashMovement>(r.movements_json),
    settlements: parseList<AccountPayment>(r.settlements_json)
  }
}

const SELECT = `SELECT id, terminal_id, shift_id, shift_name, business_date, cashier_user_id,
                       cashier_name, opened_at, opening_float_cents, status, responsible_user_id,
                       responsible_name, accepted_at, closed_at,
                       closed_by_user_id, closed_by_name, expected_cash_cents, counted_cash_cents,
                       difference_cents, closing_float_cents, z_number, sales_count, total_cents,
                       tenders_json, breakdown_json, fiados_json, sellers_json,
                       float_adjustments_json, movements_json, settlements_json
                  FROM cash_sessions`

export interface InsertSessionInput {
  id: string
  terminalId: string
  shiftId: string | null
  shiftName: string | null
  businessDate: string | null
  cashierUserId: string | null
  cashierName: string
  openedAt: string
  openingFloatCents: number
  /** Set when the opener is present to answer for it; null for a handover caja. */
  responsible: { userId: string | null; name: string } | null
}

export function insertOpenSession(db: DB, s: InsertSessionInput): void {
  db.prepare(
    `INSERT INTO cash_sessions
       (id, terminal_id, shift_id, shift_name, business_date, cashier_user_id, cashier_name,
        opened_at, opening_float_cents, status, responsible_user_id, responsible_name, accepted_at)
     VALUES (@id, @terminalId, @shiftId, @shiftName, @businessDate, @cashierUserId, @cashierName,
        @openedAt, @openingFloatCents, 'open', @responsibleUserId, @responsibleName, @acceptedAt)`
  ).run({
    id: s.id,
    terminalId: s.terminalId,
    shiftId: s.shiftId,
    shiftName: s.shiftName,
    businessDate: s.businessDate,
    cashierUserId: s.cashierUserId,
    cashierName: s.cashierName,
    openedAt: s.openedAt,
    openingFloatCents: s.openingFloatCents,
    responsibleUserId: s.responsible?.userId ?? null,
    responsibleName: s.responsible?.name ?? null,
    acceptedAt: s.responsible ? s.openedAt : null
  })
}

/** Make someone responsible for an open caja that has none yet. Returns false if it already had one. */
export function setSessionResponsible(
  db: DB,
  id: string,
  responsible: { userId: string | null; name: string },
  acceptedAt: string
): boolean {
  const result = db
    .prepare(
      `UPDATE cash_sessions
          SET responsible_user_id = @userId, responsible_name = @name, accepted_at = @acceptedAt
        WHERE id = @id AND status = 'open' AND responsible_name IS NULL`
    )
    .run({ id, userId: responsible.userId, name: responsible.name, acceptedAt })
  return result.changes === 1
}

/** Open cajas on a terminal, oldest first. Normally exactly zero or one. */
export function getOpenSessions(db: DB, terminalId: string): CashSession[] {
  const rows = db
    .prepare(`${SELECT} WHERE terminal_id = ? AND status = 'open' ORDER BY opened_at`)
    .all(terminalId) as SessionRow[]
  return rows.map(mapRow)
}

export function getSessionById(db: DB, id: string): CashSession | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as SessionRow | undefined
  return row ? mapRow(row) : null
}

/** History, newest first (open ones surface first via opened_at on ties). */
export function listSessions(db: DB, limit = 100): CashSession[] {
  const rows = db.prepare(`${SELECT} ORDER BY opened_at DESC LIMIT ?`).all(limit) as SessionRow[]
  return rows.map(mapRow)
}

/** Set the shift of an open caja (used to fix cajas opened before shifts existed). */
export function updateSessionShift(
  db: DB,
  id: string,
  slot: { shiftId: string; shiftName: string; businessDate: string }
): void {
  db.prepare(
    `UPDATE cash_sessions SET shift_id = ?, shift_name = ?, business_date = ?
      WHERE id = ? AND status = 'open'`
  ).run(slot.shiftId, slot.shiftName, slot.businessDate, id)
}

/** Replace an open caja's opening float, appending the correction to its log. */
export function updateOpeningFloat(
  db: DB,
  id: string,
  openingFloatCents: number,
  adjustments: FloatAdjustment[]
): void {
  db.prepare(
    `UPDATE cash_sessions
        SET opening_float_cents = ?, float_adjustments_json = ?
      WHERE id = ? AND status = 'open'`
  ).run(openingFloatCents, JSON.stringify(adjustments), id)
}

/** Most recently closed caja on a terminal (its float is what's in the drawer now). */
export function getLastClosedSession(db: DB, terminalId: string): CashSession | null {
  const row = db
    .prepare(
      `${SELECT} WHERE terminal_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`
    )
    .get(terminalId) as SessionRow | undefined
  return row ? mapRow(row) : null
}

export interface CloseSessionFields {
  closedAt: string
  closedByUserId: string | null
  closedByName: string
  expectedCashCents: number
  countedCashCents: number
  differenceCents: number
  closingFloatCents: number
  zNumber: number
  salesCount: number
  totalCents: number
  tenders: Tenders
  breakdown: ZBreakdownRow[]
  fiados: FiadoEntry[]
  sellers: SellerTotal[]
  cashMovements: CashMovement[]
  settlements: AccountPayment[]
}

/** Next fiscal cierre number for a terminal (MAX(z_number)+1 over closed cajas). */
export function nextZNumber(db: DB, terminalId: string): number {
  const row = db
    .prepare<[string], { next: number }>(
      `SELECT COALESCE(MAX(z_number), 0) + 1 AS next
         FROM cash_sessions WHERE terminal_id = ?`
    )
    .get(terminalId)!
  return row.next
}

export function closeSessionRow(db: DB, id: string, f: CloseSessionFields): void {
  db.prepare(
    `UPDATE cash_sessions
        SET status = 'closed',
            closed_at = @closedAt,
            closed_by_user_id = @closedByUserId,
            closed_by_name = @closedByName,
            expected_cash_cents = @expectedCashCents,
            counted_cash_cents = @countedCashCents,
            difference_cents = @differenceCents,
            closing_float_cents = @closingFloatCents,
            z_number = @zNumber,
            sales_count = @salesCount,
            total_cents = @totalCents,
            tenders_json = @tendersJson,
            breakdown_json = @breakdownJson,
            fiados_json = @fiadosJson,
            sellers_json = @sellersJson,
            movements_json = @movementsJson,
            settlements_json = @settlementsJson
      WHERE id = @id`
  ).run({
    id,
    closedAt: f.closedAt,
    closedByUserId: f.closedByUserId,
    closedByName: f.closedByName,
    expectedCashCents: f.expectedCashCents,
    countedCashCents: f.countedCashCents,
    differenceCents: f.differenceCents,
    closingFloatCents: f.closingFloatCents,
    zNumber: f.zNumber,
    salesCount: f.salesCount,
    totalCents: f.totalCents,
    tendersJson: JSON.stringify(f.tenders),
    breakdownJson: JSON.stringify(f.breakdown),
    fiadosJson: JSON.stringify(f.fiados),
    sellersJson: JSON.stringify(f.sellers),
    movementsJson: JSON.stringify(f.cashMovements),
    settlementsJson: JSON.stringify(f.settlements)
  })
}
