import type { SyncEnvelope } from '../../shared/types'
import type { SyncQueueItem } from '../repositories/syncQueue'

export type FetchLike = typeof fetch

/** Error carrying whether the failure is worth retrying (network/5xx) or not (4xx). */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

export interface SyncClient {
  push: (item: SyncQueueItem) => Promise<void>
}

function toEnvelope(item: SyncQueueItem): SyncEnvelope {
  return {
    id: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    payload: item.payload,
    createdAt: item.createdAt
  }
}

/**
 * POSTs sync envelopes to `${baseUrl}/api/sync`. `fetchFn` is injectable for
 * tests. Network failures and 5xx/408/429 are retryable; other 4xx are not.
 *
 * `baseUrl` may be a function so the endpoint is resolved per request — this lets
 * the backend URL change at runtime (Settings) without rebuilding the worker.
 */
export function createSyncClient(
  baseUrl: string | (() => string),
  fetchFn: FetchLike = fetch
): SyncClient {
  const resolveBase = typeof baseUrl === 'function' ? baseUrl : (): string => baseUrl
  return {
    async push(item) {
      const endpoint = `${resolveBase()}/api/sync`
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toEnvelope(item))
      }).catch((cause) => {
        // Connection refused / offline -> retry later.
        throw new SyncError(`Network error: ${String(cause)}`, undefined, true)
      })

      if (!response.ok) {
        const retryable =
          response.status >= 500 || response.status === 408 || response.status === 429
        throw new SyncError(`Sync failed with HTTP ${response.status}`, response.status, retryable)
      }
    }
  }
}
