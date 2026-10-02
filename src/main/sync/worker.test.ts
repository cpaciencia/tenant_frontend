import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { countPending, getPending } from '../repositories/syncQueue'
import { SyncWorker } from './worker'
import { SyncError, type SyncClient } from './client'

let db: DB

function enqueue(id: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, created_at)
     VALUES (?, 'sale', ?, 'create', '{"v":1}', ?)`
  ).run(id, id, createdAt)
}

function attemptsOf(id: string): number {
  return (
    db.prepare('SELECT attempts FROM sync_queue WHERE id = ?').get(id) as { attempts: number }
  ).attempts
}

const okClient: SyncClient = { push: async () => undefined }
const retryableClient: SyncClient = {
  push: async () => {
    throw new SyncError('down', 503, true)
  }
}
const nonRetryableClient: SyncClient = {
  push: async () => {
    throw new SyncError('bad', 400, false)
  }
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  enqueue('a', '2026-01-01T00:00:00.000Z')
  enqueue('b', '2026-01-02T00:00:00.000Z')
  enqueue('c', '2026-01-03T00:00:00.000Z')
})

describe('SyncWorker.runOnce', () => {
  it('syncs all pending rows when the backend accepts them', async () => {
    const worker = new SyncWorker(db, okClient)
    const synced = await worker.runOnce()
    expect(synced).toBe(3)
    expect(countPending(db)).toBe(0)
  })

  it('aborts the batch on a retryable failure and leaves the rest untouched', async () => {
    const worker = new SyncWorker(db, retryableClient)
    const synced = await worker.runOnce()
    expect(synced).toBe(0)
    // Only the first row (oldest) was attempted before bailing out.
    expect(attemptsOf('a')).toBe(1)
    expect(attemptsOf('b')).toBe(0)
    expect(attemptsOf('c')).toBe(0)
    expect(countPending(db)).toBe(3)
  })

  it('parks (skips) only the offending row on a non-retryable failure', async () => {
    const worker = new SyncWorker(db, nonRetryableClient)
    const synced = await worker.runOnce()
    expect(synced).toBe(0)
    // Every row was attempted once, none synced.
    expect([attemptsOf('a'), attemptsOf('b'), attemptsOf('c')]).toEqual([1, 1, 1])
  })

  it('ignores rows that have exhausted maxAttempts', async () => {
    db.prepare('UPDATE sync_queue SET attempts = 5').run()
    const worker = new SyncWorker(db, okClient, { maxAttempts: 5 })
    expect(await worker.runOnce()).toBe(0)
    expect(getPending(db, 10, 5)).toHaveLength(0)
  })
})

describe('SyncWorker.drain', () => {
  it('drains every pending row across multiple batches', async () => {
    // 5 rows with batchSize 2 needs 3 batches; drain should clear them all.
    enqueue('d', '2026-01-04T00:00:00.000Z')
    enqueue('e', '2026-01-05T00:00:00.000Z')
    const worker = new SyncWorker(db, okClient, { batchSize: 2 })
    const synced = await worker.drain()
    expect(synced).toBe(5)
    expect(countPending(db)).toBe(0)
  })

  it('stops without spinning when the backend is unreachable', async () => {
    const worker = new SyncWorker(db, retryableClient)
    const synced = await worker.drain()
    expect(synced).toBe(0)
    expect(countPending(db)).toBe(3)
  })
})
