import type { DB } from '../db/connection'
import { getPending, markSynced, markFailed } from '../repositories/syncQueue'
import { SyncError, type SyncClient } from './client'

export interface SyncWorkerOptions {
  /** Polling interval in ms. Default 10s. */
  intervalMs?: number
  /** Max rows processed per tick. Default 20. */
  batchSize?: number
  /** Park a row after this many failed attempts. Default 5. */
  maxAttempts?: number
}

/**
 * Background worker (Main process) that drains `sync_queue` to the backend.
 * Offline-first: a network/5xx failure aborts the current batch so we don't
 * hammer an unreachable server — the next tick retries. Non-retryable (4xx)
 * failures only park the offending row. The core (`runOnce`) is pure logic over
 * an injected DB + client, so it's fully unit-testable.
 */
export class SyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private readonly intervalMs: number
  private readonly batchSize: number
  private readonly maxAttempts: number

  constructor(
    private readonly db: DB,
    private readonly client: SyncClient,
    options: SyncWorkerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 10_000
    this.batchSize = options.batchSize ?? 20
    this.maxAttempts = options.maxAttempts ?? 5
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs)
    // Don't keep the process alive just for the poll timer.
    this.timer.unref?.()
    void this.runOnce()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Drains as many batches as possible right now (one batch per `runOnce`). Stops
   * when a tick syncs nothing — queue empty, backend unreachable, or rows parked —
   * so it never spins. `maxLoops` is a hard safety cap. Returns total rows synced.
   */
  async drain(maxLoops = 500): Promise<number> {
    let total = 0
    for (let i = 0; i < maxLoops; i++) {
      const synced = await this.runOnce()
      if (synced === 0) break
      total += synced
    }
    return total
  }

  /** Processes one batch. Returns the number of rows successfully synced. */
  async runOnce(): Promise<number> {
    if (this.running) return 0
    this.running = true
    let syncedCount = 0
    try {
      const pending = getPending(this.db, this.batchSize, this.maxAttempts)
      for (const item of pending) {
        try {
          await this.client.push(item)
          markSynced(this.db, item.id)
          syncedCount++
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          markFailed(this.db, item.id, message)
          // Retryable failure usually means the backend is unreachable: stop the
          // batch and try again next tick. Non-retryable: skip just this row.
          if (!(error instanceof SyncError) || error.retryable) break
        }
      }
    } finally {
      this.running = false
    }
    return syncedCount
  }
}
