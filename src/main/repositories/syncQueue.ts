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

/** Queue counts in one shot: pending (synced = 0) and total (everything ever enqueued). */
export function countTotals(db: DB): { pending: number; total: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END), 0) AS pending
         FROM sync_queue`
    )
    .get() as { total: number; pending: number }
  return { total: row.total, pending: row.pending }
}

/**
 * Marks every queued row as un-synced again (and resets attempts/error) so the
 * worker re-pushes the full local history. Rows keep their original payload and
 * envelope id; backend ingestion is idempotent. Returns how many rows were reset.
 *
 * Intended for recovery after the backend database was wiped — the cloud no longer
 * has these sales, but the local mirror still does.
 */
export function requeueAll(db: DB): number {
  const result = db
    .prepare('UPDATE sync_queue SET synced = 0, attempts = 0, last_error = NULL')
    .run()
  return result.changes
}
