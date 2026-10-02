import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type {
  AcceptSessionRequest,
  CashSession,
  CloseSessionRequest,
  CloseSessionResult,
  FiadoEntry,
  OpenSessionRequest,
  SellerTotal,
  SessionArqueo,
  Tenders,
  ZBreakdownRow
} from '../../shared/types'
import {
  handoverSlot,
  localDate,
  resolveShiftAt,
  type ShiftDefinition,
  type ShiftSlot
} from '../../shared/shifts'
import { listAccountingGroups } from '../repositories/accountingGroups'
import { recordAuditEvent } from '../repositories/auditEvents'
import {
  countPendingInvoices,
  drawerEffectCents,
  listCashMovements,
  summarizeCashMovements
} from '../repositories/cashMovements'
import { insertMovementInTxn } from './cashMovements'
import { listSessionPayments, summarizeSettlements } from './accountPayments'
import {
  insertOpenSession,
  getOpenSessions,
  getSessionById,
  getLastClosedSession,
  listSessions,
  closeSessionRow,
  nextZNumber,
  setSessionResponsible,
  updateOpeningFloat,
  updateSessionShift
} from '../repositories/cashSessions'

const NO_CAJA_KEY = '__none__'

/**
 * Sync operations for a caja snapshot. The backend upserts by caja id, so it can
 * show open cajas live: `open` when a caja starts, `update` when someone accepts
 * it, `create` when it is closed (the name predates live cajas and is kept so
 * queued rows from older clients stay valid).
 */
type CashSessionSyncOp = 'open' | 'update' | 'create'

/** Queue the caja's current snapshot for the backend (same transaction as the change). */
function enqueueSnapshot(db: DB, session: CashSession, operation: CashSessionSyncOp): void {
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'cash_session', ?, ?, ?)`
  ).run(uuidv7(), session.id, operation, JSON.stringify(session))
}
const NO_CLIENT_NAME = 'Sin cliente indicado'

interface SaleAggRow {
  id: string
  ticket_number: string
  total_cents: number
  cash_cents: number
  card_cents: number
  credit_cents: number
  client_id: string | null
  client_name: string | null
  cashier_user_id: string | null
  cashier_name: string | null
  created_at: string
  items_json: string
}

interface SaleItem {
  quantity: number
  unitPriceCents: number
  accountingGroupId: string | null
}

interface Aggregate {
  salesCount: number
  totalCents: number
  tenders: Tenders
  breakdown: ZBreakdownRow[]
  fiados: FiadoEntry[]
  sellers: SellerTotal[]
}

/**
 * Totals, tender split, per-accounting-group breakdown, fiado list and per-seller
 * totals for every sale tagged to a caja.
 */
function aggregateSession(db: DB, sessionId: string): Aggregate {
  const rows = db
    .prepare(
      `SELECT id, ticket_number, total_cents, cash_cents, card_cents, credit_cents,
              client_id, client_name, cashier_user_id, cashier_name, created_at, items_json
         FROM sales
        WHERE cash_session_id = ? AND status = 'completed'
        ORDER BY created_at`
    )
    .all(sessionId) as SaleAggRow[]

  const cajas = new Map(listAccountingGroups(db).map((g) => [g.id, g]))
  const buckets = new Map<string, ZBreakdownRow>()
  const sellers = new Map<string, SellerTotal>()
  const fiados: FiadoEntry[] = []
  const tenders: Tenders = { cashCents: 0, cardCents: 0, creditCents: 0 }
  let totalCents = 0

  for (const row of rows) {
    totalCents += row.total_cents
    tenders.cashCents += row.cash_cents
    tenders.cardCents += row.card_cents
    tenders.creditCents += row.credit_cents

    if (row.credit_cents !== 0) {
      fiados.push({
        saleId: row.id,
        ticketNumber: row.ticket_number,
        clientId: row.client_id,
        clientName: row.client_name?.trim() || NO_CLIENT_NAME,
        amountCents: row.credit_cents,
        createdAt: row.created_at
      })
    }

    const sellerName = row.cashier_name?.trim() || 'Desconocido'
    const sellerKey = row.cashier_user_id ?? `name:${sellerName}`
    const seller = sellers.get(sellerKey)
    if (seller) {
      seller.salesCount += 1
      seller.totalCents += row.total_cents
    } else {
      sellers.set(sellerKey, {
        userId: row.cashier_user_id,
        name: sellerName,
        salesCount: 1,
        totalCents: row.total_cents
      })
    }

    let items: SaleItem[] = []
    try {
      items = JSON.parse(row.items_json) as SaleItem[]
    } catch {
      items = []
    }
    for (const item of items) {
      const lineTotal = item.quantity * item.unitPriceCents
      const key = item.accountingGroupId ?? NO_CAJA_KEY
      const existing = buckets.get(key)
      if (existing) {
        existing.totalCents += lineTotal
        continue
      }
      const caja = item.accountingGroupId ? cajas.get(item.accountingGroupId) : undefined
      buckets.set(key, {
        accountingGroupId: item.accountingGroupId,
        code: caja?.code ?? (item.accountingGroupId ? '??' : 'SIN GRUPO'),
        name: caja?.name ?? (item.accountingGroupId ? 'Grupo desconocido' : 'Sin grupo asignado'),
        totalCents: lineTotal
      })
    }
  }

  const breakdown = [...buckets.values()].sort((a, b) => a.code.localeCompare(b.code))
  const sellerList = [...sellers.values()].sort((a, b) => b.totalCents - a.totalCents)
  return { salesCount: rows.length, totalCents, tenders, breakdown, fiados, sellers: sellerList }
}

/** The shift slot a caja belongs to; cajas from before shifts existed are inferred from their open time. */
function slotOf(session: CashSession, shifts: ShiftDefinition[]): ShiftSlot | null {
  if (session.shiftId && session.businessDate && shifts.some((s) => s.id === session.shiftId)) {
    return {
      shiftId: session.shiftId,
      shiftName: session.shiftName ?? session.shiftId,
      businessDate: session.businessDate
    }
  }
  return resolveShiftAt(shifts, new Date(session.openedAt))
}

/** Slot for a manually opened caja: the requested shift (or the one running now). */
function slotForOpen(
  shifts: ShiftDefinition[],
  shiftId: string | null | undefined,
  now: Date
): ShiftSlot | null {
  const running = resolveShiftAt(shifts, now)
  if (!shiftId || running?.shiftId === shiftId) return running
  const shift = shifts.find((s) => s.id === shiftId)
  if (!shift) throw new Error('Turno desconocido')
  return { shiftId: shift.id, shiftName: shift.name, businessDate: localDate(now) }
}

function insertSession(
  db: DB,
  terminalId: string,
  slot: ShiftSlot | null,
  opener: { userId: string | null; name: string },
  openingFloatCents: number,
  now: Date,
  responsible: { userId: string | null; name: string } | null
): string {
  const id = uuidv7()
  insertOpenSession(db, {
    id,
    terminalId,
    shiftId: slot?.shiftId ?? null,
    shiftName: slot?.shiftName ?? null,
    businessDate: slot?.businessDate ?? null,
    cashierUserId: opener.userId,
    cashierName: opener.name,
    openedAt: now.toISOString(),
    openingFloatCents: Math.max(0, Math.round(openingFloatCents)),
    responsible
  })
  return id
}

/**
 * Open the terminal's caja for a shift. Normally only needed the very first time
 * (closing a caja already opens the next one); refused while another caja is open,
 * since the terminal has a single drawer. Whoever opens it by hand is present, so
 * they are its responsible straight away.
 */
export function openCashSession(
  db: DB,
  terminalId: string,
  req: OpenSessionRequest,
  shifts: ShiftDefinition[],
  now: Date = new Date()
): CashSession {
  const txn = db.transaction((): CashSession => {
    if (getOpenSessions(db, terminalId).length > 0) {
      throw new Error('Ya hay una caja abierta en este terminal')
    }
    const opener = { userId: req.cashierUserId, name: req.cashierName }
    const id = insertSession(
      db,
      terminalId,
      slotForOpen(shifts, req.shiftId, now),
      opener,
      req.openingFloatCents,
      now,
      opener
    )
    const opened = getSessionById(db, id)!
    enqueueSnapshot(db, opened, 'open')
    recordAuditEvent(db, {
      type: 'cash_session.opened',
      terminalId,
      actor: opener,
      cashSessionId: id,
      entityId: id,
      occurredAt: now,
      data: {
        shiftName: opened.shiftName,
        businessDate: opened.businessDate,
        floatCents: opened.openingFloatCents,
        handover: false
      }
    })
    return opened
  })
  return txn.immediate()
}

/** An open caja of this terminal, or a clear error. */
function requireOpenSession(db: DB, terminalId: string, sessionId: string): CashSession {
  const session = getSessionById(db, sessionId)
  if (!session || session.terminalId !== terminalId) {
    throw new Error('Caja no encontrada')
  }
  if (session.status !== 'open') {
    throw new Error('La caja ya está cerrada')
  }
  return session
}

/**
 * Set the drawer float to what the accepting cashier actually counted, logging
 * the correction (who, when, from → to) so the cierre shows it. A no-op when the
 * amount doesn't change. Must run inside a transaction. This is the only moment a
 * float can change: once a caja has a responsible, its float is locked.
 */
function applyFloatCorrection(
  db: DB,
  session: CashSession,
  openingFloatCents: number,
  by: { userId: string | null; name: string },
  now: Date
): boolean {
  const toCents = Math.max(0, Math.round(openingFloatCents))
  if (toCents === session.openingFloatCents) return false
  updateOpeningFloat(db, session.id, toCents, [
    ...session.floatAdjustments,
    {
      at: now.toISOString(),
      userId: by.userId,
      userName: by.name,
      fromCents: session.openingFloatCents,
      toCents
    }
  ])
  return true
}

/**
 * The person arriving for the shift takes responsibility for the caja left open
 * by the previous cierre (fondo + whatever was sold since). If they counted a
 * different float in the drawer, it is corrected in the same step. Refused if
 * someone already accepted it.
 */
export function acceptCashSession(
  db: DB,
  terminalId: string,
  req: AcceptSessionRequest,
  now: Date = new Date()
): CashSession {
  const txn = db.transaction((): CashSession => {
    const session = requireOpenSession(db, terminalId, req.sessionId)
    const me = { userId: req.userId, name: req.userName }
    const accepted = setSessionResponsible(db, req.sessionId, me, now.toISOString())
    if (!accepted) {
      throw new Error(`La caja ya tiene responsable: ${session.responsibleName ?? ''}`.trim())
    }
    if (req.openingFloatCents != null) {
      applyFloatCorrection(db, session, req.openingFloatCents, me, now)
    }
    const updated = getSessionById(db, req.sessionId)!
    enqueueSnapshot(db, updated, 'update')
    recordAuditEvent(db, {
      type: 'cash_session.accepted',
      terminalId,
      actor: me,
      cashSessionId: updated.id,
      entityId: updated.id,
      occurredAt: now,
      data: {
        shiftName: updated.shiftName,
        businessDate: updated.businessDate,
        floatLeftCents: session.openingFloatCents,
        floatCountedCents: updated.openingFloatCents
      }
    })
    return updated
  })
  return txn.immediate()
}

/**
 * Give a shift to open cajas that have none (opened by an older app version, before
 * shifts existed): the one running when they were opened. Without it the till shows
 * "Sin turno" until that caja is closed. Returns how many were fixed.
 */
export function assignMissingShifts(db: DB, terminalId: string, shifts: ShiftDefinition[]): number {
  const txn = db.transaction((): number => {
    let fixed = 0
    for (const session of getOpenSessions(db, terminalId)) {
      if (session.shiftId) continue
      const slot = resolveShiftAt(shifts, new Date(session.openedAt))
      if (!slot) continue
      updateSessionShift(db, session.id, slot)
      enqueueSnapshot(db, getSessionById(db, session.id)!, 'update')
      fixed += 1
    }
    return fixed
  })
  return txn.immediate()
}

/** The terminal's open caja, if any (oldest first should a legacy overlap remain). */
export function getCurrentCashSession(db: DB, terminalId: string): CashSession | null {
  return getOpenSessions(db, terminalId)[0] ?? null
}

/** Float left in the drawer by the last cierre — the natural opening float. */
export function lastClosingFloat(db: DB, terminalId: string): number | null {
  return getLastClosedSession(db, terminalId)?.closingFloatCents ?? null
}

/** Past + present cajas, newest first. */
export function listCashSessions(db: DB, limit = 100): CashSession[] {
  return listSessions(db, limit)
}

/** Live arqueo of an open caja (no sealing): totals so far + expected cash. */
export function previewSessionArqueo(db: DB, sessionId: string): SessionArqueo {
  const session = getSessionById(db, sessionId)
  if (!session || session.status !== 'open') {
    throw new Error('La caja no está abierta')
  }
  const agg = aggregateSession(db, sessionId)
  const movements = summarizeCashMovements(listCashMovements(db, sessionId))
  const settlements = summarizeSettlements(listSessionPayments(db, sessionId))
  return {
    sessionId,
    shiftName: session.shiftName,
    businessDate: session.businessDate,
    cashierName: session.cashierName,
    openedAt: session.openedAt,
    openingFloatCents: session.openingFloatCents,
    salesCount: agg.salesCount,
    totalCents: agg.totalCents,
    tenders: agg.tenders,
    breakdown: agg.breakdown,
    fiados: agg.fiados,
    sellers: agg.sellers,
    movements,
    settlements,
    expectedCashCents:
      session.openingFloatCents +
      agg.tenders.cashCents +
      settlements.cashCents +
      drawerEffectCents(movements)
  }
}

/**
 * The cierre. In ONE transaction: aggregates the caja's sales, allocates the
 * fiscal per-terminal Z number, records the arqueo (expected vs counted cash →
 * difference) and who closed it, enqueues the sync row, and opens the NEXT
 * shift's caja with the float left in the drawer — selling never stops, and
 * nobody has to log in as the next cashier to open it. That next caja starts
 * without a responsible: the next person on duty accepts it at login. A caja can
 * only be closed once someone has accepted it — someone must answer for it.
 */
export function closeCashSession(
  db: DB,
  terminalId: string,
  req: CloseSessionRequest,
  shifts: ShiftDefinition[],
  now: Date = new Date()
): CloseSessionResult {
  const txn = db.transaction((): CloseSessionResult => {
    const session = getSessionById(db, req.sessionId)
    if (!session) {
      throw new Error('Caja no encontrada')
    }
    if (session.status !== 'open') {
      throw new Error('La caja ya está cerrada')
    }
    if (session.terminalId !== terminalId) {
      throw new Error('La caja pertenece a otro terminal')
    }
    if (!session.responsibleName) {
      throw new Error('La caja no tiene responsable: acéptala antes de cerrarla')
    }

    const missingInvoices = countPendingInvoices(db, session.id)
    if (missingInvoices > 0) {
      throw new Error(
        `Falta subir la factura de ${missingInvoices} pago(s) a proveedor (en Movimientos)`
      )
    }

    const closer = { userId: req.closedByUserId, name: req.closedByName }
    // Money put in and not yet taken out can be taken out as part of the cierre.
    if (req.cashOutCents && req.cashOutCents > 0) {
      insertMovementInTxn(
        db,
        terminalId,
        session.id,
        {
          kind: 'cash_out',
          amountCents: req.cashOutCents,
          note: 'Devuelto al cerrar la caja',
          actor: closer
        },
        now
      )
    }
    const agg = aggregateSession(db, req.sessionId)
    const movements = summarizeCashMovements(listCashMovements(db, req.sessionId))
    // Debt payments in cash are money in the drawer (but not sales).
    const settlements = summarizeSettlements(listSessionPayments(db, req.sessionId))
    const expectedCashCents =
      session.openingFloatCents +
      agg.tenders.cashCents +
      settlements.cashCents +
      drawerEffectCents(movements)
    const countedCashCents = Math.round(req.countedCashCents)
    const closingFloatCents = Math.max(0, Math.round(req.closingFloatCents))

    closeSessionRow(db, req.sessionId, {
      closedAt: now.toISOString(),
      closedByUserId: req.closedByUserId,
      closedByName: req.closedByName,
      expectedCashCents,
      countedCashCents,
      differenceCents: countedCashCents - expectedCashCents,
      closingFloatCents,
      zNumber: nextZNumber(db, terminalId),
      salesCount: agg.salesCount,
      totalCents: agg.totalCents,
      tenders: agg.tenders,
      breakdown: agg.breakdown,
      fiados: agg.fiados,
      sellers: agg.sellers,
      cashMovements: movements.list,
      settlements: settlements.list
    })

    const closed = getSessionById(db, req.sessionId)!
    enqueueSnapshot(db, closed, 'create')
    recordAuditEvent(db, {
      type: 'cash_session.closed',
      terminalId,
      actor: closer,
      cashSessionId: closed.id,
      entityId: closed.id,
      occurredAt: now,
      data: {
        zNumber: closed.zNumber,
        shiftName: closed.shiftName,
        businessDate: closed.businessDate,
        responsibleName: closed.responsibleName,
        salesCount: closed.salesCount,
        totalCents: closed.totalCents,
        expectedCashCents: closed.expectedCashCents,
        countedCashCents: closed.countedCashCents,
        differenceCents: closed.differenceCents,
        closingFloatCents: closed.closingFloatCents
      }
    })

    // One drawer → one open caja. If another is still open (left over from the
    // old per-cashier model), it becomes the current one instead of piling up a
    // new caja on every cierre.
    const stillOpen = getOpenSessions(db, terminalId)[0]
    if (stillOpen) {
      return { closed, next: stillOpen }
    }

    const closingSlot = slotOf(session, shifts)
    const nextSlot =
      (closingSlot && handoverSlot(shifts, closingSlot, now)) ?? resolveShiftAt(shifts, now)
    const nextId = insertSession(db, terminalId, nextSlot, closer, closingFloatCents, now, null)
    const next = getSessionById(db, nextId)!
    enqueueSnapshot(db, next, 'open')
    recordAuditEvent(db, {
      type: 'cash_session.opened',
      terminalId,
      actor: closer,
      cashSessionId: next.id,
      entityId: next.id,
      occurredAt: now,
      data: {
        shiftName: next.shiftName,
        businessDate: next.businessDate,
        floatCents: next.openingFloatCents,
        handover: true
      }
    })

    return { closed, next }
  })

  return txn.immediate()
}
