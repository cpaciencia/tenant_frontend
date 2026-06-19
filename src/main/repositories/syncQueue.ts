import type { DB } from '../db/connection'

export interface SyncQueueItem {
  id: string
  entityType: string
  entityId: string
  operation: string
  payload: unknown
  createdAt: string
  attempts: number
}

interface SyncQueueRow {
  id: string
  entity_type: string
  entity_id: string
  operation: string
  payload: string
  created_at: string
  attempts: number
}

function mapRow(row: SyncQueueRow): SyncQueueItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
    attempts: row.attempts
  }
}

/**
 * Pending rows, oldest first. Rows that have exhausted `maxAttempts` are parked
 * (excluded) so a poison payload can't block the rest of the queue forever —
 * their `last_error` stays visible for diagnosis.
 */
export function getPending(db: DB, limit: number, maxAttempts: number): SyncQueueItem[] {
  const rows = db
    .prepare(
      `SELECT id, entity_type, entity_id, operation, payload, created_at, attempts
         FROM sync_queue
        WHERE synced = 0 AND attempts < ?
        ORDER BY created_at
        LIMIT ?`
    )
    .all(maxAttempts, limit) as SyncQueueRow[]
  return rows.map(mapRow)
}

export function markSynced(db: DB, id: string): void {
  db.prepare(
    `UPDATE sync_queue
        SET synced = 1, synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL
      WHERE id = ?`
  ).run(id)
}

export function markFailed(db: DB, id: string, error: string): void {
  db.prepare('UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(
    error,
    id
  )
}

export function countPending(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM sync_queue WHERE synced = 0').get() as {
    n: number
  }
  return row.n
}
