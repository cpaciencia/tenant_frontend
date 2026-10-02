import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { Client, ClientMovement, CreateClientRequest } from '../../shared/types'
import { recordAuditEvent } from './auditEvents'

interface ClientRow {
  id: string
  name: string
  detail: string | null
  phone: string | null
  active: number
  remote_balance_cents: number
  balance_cents: number
}

/** Mirror row from GET /api/catalog/clients (balance WITHOUT this terminal). */
export interface MirroredClient {
  id: string
  name: string
  detail: string | null
  phone: string | null
  active: boolean
  updatedAt: string
  balanceOtherTerminalsCents: number
}

/**
 * Balance = what the client owes on other terminals (server, last sync) + this
 * till's credit sales − this till's debt payments. Exact offline.
 */
const SELECT_WITH_BALANCE = `
  SELECT c.id, c.name, c.detail, c.phone, c.active, c.remote_balance_cents,
         c.remote_balance_cents
           + COALESCE((SELECT SUM(s.credit_cents) FROM sales s
                        WHERE s.client_id = c.id AND s.status = 'completed'), 0)
           - COALESCE((SELECT SUM(p.total_cents) FROM account_payments p
                        WHERE p.client_id = c.id), 0) AS balance_cents
    FROM clients c`

function mapRow(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    detail: r.detail,
    phone: r.phone,
    active: r.active === 1,
    balanceCents: r.balance_cents
  }
}

/** Active clients (plus anyone who still owes), by name. */
export function listClients(db: DB): Client[] {
  const rows = db
    .prepare(`${SELECT_WITH_BALANCE} ORDER BY c.name COLLATE NOCASE`)
    .all() as ClientRow[]
  return rows.filter((r) => r.active === 1 || r.balance_cents !== 0).map(mapRow)
}

export function getClient(db: DB, id: string): Client | null {
  const row = db.prepare(`${SELECT_WITH_BALANCE} WHERE c.id = ?`).get(id) as ClientRow | undefined
  return row ? mapRow(row) : null
}

/** What the client owes on other terminals, as of the last sync. */
export function otherTerminalsBalance(db: DB, id: string): number {
  const row = db.prepare('SELECT remote_balance_cents AS n FROM clients WHERE id = ?').get(id) as
    | { n: number }
    | undefined
  return row?.n ?? 0
}

/** New client added at the till (works offline): synced and audited. */
export function createClient(
  db: DB,
  terminalId: string,
  req: CreateClientRequest,
  now = new Date()
): Client {
  const name = req.name?.trim()
  if (!name) throw new Error('Indica el nombre del cliente')
  const client = {
    id: uuidv7(),
    name,
    detail: req.detail?.trim() || null,
    phone: req.phone?.trim() || null
  }
  const txn = db.transaction((): Client => {
    db.prepare(
      `INSERT INTO clients (id, name, detail, phone, active, remote_balance_cents, updated_at)
       VALUES (@id, @name, @detail, @phone, 1, 0, @now)`
    ).run({ ...client, now: now.toISOString() })
    db.prepare(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
       VALUES (?, 'client', ?, 'upsert', ?)`
    ).run(
      uuidv7(),
      client.id,
      JSON.stringify({ ...client, createdByName: req.actor.name, createdAt: now.toISOString() })
    )
    recordAuditEvent(db, {
      type: 'client.created',
      terminalId,
      actor: req.actor,
      entityId: client.id,
      occurredAt: now,
      data: { name: client.name, detail: client.detail }
    })
    return getClient(db, client.id)!
  })
  return txn.immediate()
}

/** Upsert the backend's clients (never deletes: a client added offline here stays). */
export function upsertClients(db: DB, rows: MirroredClient[]): number {
  const stmt = db.prepare(
    `INSERT INTO clients (id, name, detail, phone, active, remote_balance_cents, updated_at)
     VALUES (@id, @name, @detail, @phone, @active, @remote, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, detail = excluded.detail,
       phone = excluded.phone, active = excluded.active,
       remote_balance_cents = excluded.remote_balance_cents, updated_at = excluded.updated_at`
  )
  const txn = db.transaction((): number => {
    for (const r of rows) {
      stmt.run({
        id: r.id,
        name: r.name,
        detail: r.detail,
        phone: r.phone,
        active: r.active ? 1 : 0,
        remote: r.balanceOtherTerminalsCents,
        updatedAt: r.updatedAt
      })
    }
    return rows.length
  })
  return txn()
}

/** The client's account on THIS till, newest first. */
export function localClientMovements(db: DB, clientId: string): ClientMovement[] {
  return db
    .prepare(
      `SELECT * FROM (
         SELECT 'credit_sale' AS kind, id, ticket_number AS reference, credit_cents AS amountCents,
                created_at AS createdAt, cashier_name AS userName
           FROM sales WHERE client_id = ? AND status = 'completed' AND credit_cents <> 0
         UNION ALL
         SELECT 'payment', id, payment_number, total_cents, created_at, user_name
           FROM account_payments WHERE client_id = ?
       )
       ORDER BY createdAt DESC, CASE kind WHEN 'payment' THEN 0 ELSE 1 END`
    )
    .all(clientId, clientId) as ClientMovement[]
}
