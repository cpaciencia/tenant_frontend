import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { getPending, markSynced, markFailed, countPending } from './syncQueue'

let db: DB

function enqueue(id: string, createdAt: string, attempts = 0, payload = '{"v":1}'): void {
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, created_at, attempts)
     VALUES (?, 'sale', ?, 'create', ?, ?, ?)`
  ).run(id, id, payload, createdAt, attempts)
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

describe('syncQueue repository', () => {
  it('returns pending rows oldest-first and respects the limit', () => {
    enqueue('b', '2026-01-02T00:00:00.000Z')
    enqueue('a', '2026-01-01T00:00:00.000Z')
    enqueue('c', '2026-01-03T00:00:00.000Z')
    const pending = getPending(db, 2, 5)
    expect(pending.map((p) => p.id)).toEqual(['a', 'b'])
    expect(pending[0].payload).toEqual({ v: 1 })
  })

  it('parks rows that have exhausted maxAttempts', () => {
    enqueue('ok', '2026-01-01T00:00:00.000Z', 4)
    enqueue('parked', '2026-01-01T00:00:00.000Z', 5)
    expect(getPending(db, 10, 5).map((p) => p.id)).toEqual(['ok'])
  })

  it('markSynced removes a row from the pending set', () => {
    enqueue('a', '2026-01-01T00:00:00.000Z')
    markSynced(db, 'a')
    expect(getPending(db, 10, 5)).toHaveLength(0)
    expect(countPending(db)).toBe(0)
  })

  it('markFailed increments attempts and records the error', () => {
    enqueue('a', '2026-01-01T00:00:00.000Z')
    markFailed(db, 'a', 'boom')
    const row = db.prepare('SELECT attempts, last_error FROM sync_queue WHERE id = ?').get('a') as {
      attempts: number
      last_error: string
    }
    expect(row.attempts).toBe(1)
    expect(row.last_error).toBe('boom')
  })
})
