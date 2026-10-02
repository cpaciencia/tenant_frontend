import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { Actor } from '../../shared/types'

export interface AuditEventRecord {
  type: string
  terminalId: string
  actor: Actor | null
  cashSessionId?: string | null
  entityId?: string | null
  data?: Record<string, unknown>
  occurredAt?: Date
}

/**
 * Append one event to the local audit log AND queue it for the backend, in the
 * caller's transaction when there is one. The log is append-only: rows are never
 * updated or deleted. It is the raw material for statistics (who sells what,
 * when, manual entries, voids…), so keep `data` small and factual.
 */
export function recordAuditEvent(db: DB, event: AuditEventRecord): string {
  const id = uuidv7()
  const row = {
    id,
    occurredAt: (event.occurredAt ?? new Date()).toISOString(),
    terminalId: event.terminalId,
    userId: event.actor?.userId ?? null,
    userName: event.actor?.name ?? null,
    type: event.type,
    cashSessionId: event.cashSessionId ?? null,
    entityId: event.entityId ?? null,
    dataJson: JSON.stringify(event.data ?? {})
  }
  db.prepare(
    `INSERT INTO audit_events
       (id, occurred_at, terminal_id, user_id, user_name, type, cash_session_id, entity_id, data_json)
     VALUES (@id, @occurredAt, @terminalId, @userId, @userName, @type, @cashSessionId, @entityId, @dataJson)`
  ).run(row)
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'audit_event', ?, 'create', ?)`
  ).run(
    uuidv7(),
    id,
    JSON.stringify({
      id,
      occurredAt: row.occurredAt,
      terminalId: row.terminalId,
      userId: row.userId,
      userName: row.userName,
      type: row.type,
      cashSessionId: row.cashSessionId,
      entityId: row.entityId,
      data: event.data ?? {}
    })
  )
  return id
}
