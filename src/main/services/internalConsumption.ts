import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type {
  InternalAccount,
  InternalConsumption,
  RecordConsumptionRequest
} from '../../shared/types'
import { getSessionById } from '../repositories/cashSessions'
import { recordAuditEvent } from '../repositories/auditEvents'

interface ConsumptionRow {
  id: string
  consumption_number: string
  terminal_id: string
  account_id: string
  account_name: string
  taken_by_name: string
  reason: string | null
  items_json: string
  total_cents: number
  cash_session_id: string
  user_id: string | null
  user_name: string
  created_at: string
}

function mapRow(r: ConsumptionRow): InternalConsumption {
  let items: InternalConsumption['items'] = []
  try {
    items = JSON.parse(r.items_json)
  } catch {
    items = []
  }
  return {
    id: r.id,
    consumptionNumber: r.consumption_number,
    terminalId: r.terminal_id,
    accountId: r.account_id,
    accountName: r.account_name,
    takenByName: r.taken_by_name,
    reason: r.reason,
    items,
    totalCents: r.total_cents,
    cashSessionId: r.cash_session_id,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at
  }
}

/** `CI-T01-2026-00001` — its own series: internal consumption is not a ticket. */
export function formatConsumptionNumber(
  terminalId: string,
  year: number,
  sequence: number
): string {
  return `CI-${terminalId}-${year}-${String(sequence).padStart(5, '0')}`
}

export function listInternalAccounts(db: DB): InternalAccount[] {
  return db
    .prepare('SELECT id, name FROM internal_accounts WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all() as InternalAccount[]
}

/** Replace the mirror with the backend's accounts (full pull). */
export function replaceInternalAccounts(
  db: DB,
  rows: { id: string; name: string; active: boolean; updatedAt: string }[]
): number {
  const txn = db.transaction((): number => {
    db.prepare('DELETE FROM internal_accounts').run()
    const ins = db.prepare(
      'INSERT INTO internal_accounts (id, name, active, updated_at) VALUES (?, ?, ?, ?)'
    )
    for (const r of rows) ins.run(r.id, r.name, r.active ? 1 : 0, r.updatedAt)
    return rows.length
  })
  return txn()
}

/** People who can take goods (staff in the local user mirror), by name. */
export function listStaffNames(db: DB): string[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(full_name), ''), username) AS name
         FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

/**
 * Record goods taken for internal use (from the open ticket). Not a sale: no
 * money, own numbering. Synced (the backend takes the stock and values it at
 * cost) and audited with every line, who took it and who recorded it.
 */
export function recordInternalConsumption(
  db: DB,
  terminalId: string,
  req: RecordConsumptionRequest,
  now: Date = new Date()
): InternalConsumption {
  const takenByName = req.takenByName?.trim()
  if (!takenByName) throw new Error('Indica quién se lo lleva')
  if (!req.items.length) throw new Error('No hay productos')
  for (const it of req.items) {
    if (!it.productId || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw new Error('Solo productos del catálogo (no ventas por precio)')
    }
  }
  const txn = db.transaction((): InternalConsumption => {
    const session = getSessionById(db, req.cashSessionId)
    if (!session || session.status !== 'open' || session.terminalId !== terminalId) {
      throw new Error('No hay una caja abierta')
    }
    const account = db
      .prepare('SELECT id, name FROM internal_accounts WHERE id = ? AND active = 1')
      .get(req.accountId) as InternalAccount | undefined
    if (!account) throw new Error('Elige la cuenta interna')

    const year = now.getFullYear()
    const { next } = db
      .prepare(
        `SELECT COALESCE(MAX(consumption_seq), 0) + 1 AS next
           FROM internal_consumptions WHERE terminal_id = ? AND consumption_year = ?`
      )
      .get(terminalId, year) as { next: number }
    const items = req.items.map((i) => ({
      productId: i.productId,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents
    }))
    const record: InternalConsumption = {
      id: uuidv7(),
      consumptionNumber: formatConsumptionNumber(terminalId, year, next),
      terminalId,
      accountId: account.id,
      accountName: account.name,
      takenByName,
      reason: req.reason?.trim() || null,
      items,
      totalCents: items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0),
      cashSessionId: session.id,
      userId: req.actor.userId,
      userName: req.actor.name,
      createdAt: now.toISOString()
    }
    db.prepare(
      `INSERT INTO internal_consumptions
         (id, consumption_number, terminal_id, consumption_year, consumption_seq, account_id,
          account_name, taken_by_name, reason, items_json, total_cents, cash_session_id,
          user_id, user_name, created_at)
       VALUES (@id, @consumptionNumber, @terminalId, @year, @seq, @accountId, @accountName,
          @takenByName, @reason, @itemsJson, @totalCents, @cashSessionId, @userId, @userName,
          @createdAt)`
    ).run({ ...record, year, seq: next, itemsJson: JSON.stringify(items) })
    db.prepare(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
       VALUES (?, 'internal_consumption', ?, 'create', ?)`
    ).run(uuidv7(), record.id, JSON.stringify(record))
    recordAuditEvent(db, {
      type: 'internal_consumption.recorded',
      terminalId,
      actor: req.actor,
      cashSessionId: session.id,
      entityId: record.id,
      occurredAt: now,
      data: {
        draftId: req.draftId ?? null,
        consumptionNumber: record.consumptionNumber,
        accountName: record.accountName,
        takenByName,
        reason: record.reason,
        totalCents: record.totalCents,
        units: items.reduce((n, i) => n + i.quantity, 0),
        items: items.map((i) => ({ name: i.name, quantity: i.quantity }))
      }
    })
    return record
  })
  return txn.immediate()
}

export function listSessionConsumptions(db: DB, cashSessionId: string): InternalConsumption[] {
  return (
    db
      .prepare('SELECT * FROM internal_consumptions WHERE cash_session_id = ? ORDER BY created_at')
      .all(cashSessionId) as ConsumptionRow[]
  ).map(mapRow)
}
