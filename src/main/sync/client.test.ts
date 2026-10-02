import { describe, it, expect, vi } from 'vitest'
import { setTerminalToken } from './terminalAuth'
import { createSyncClient, SyncError, type FetchLike } from './client'
import type { SyncQueueItem } from '../repositories/syncQueue'

const item: SyncQueueItem = {
  id: 'q1',
  entityType: 'sale',
  entityId: 's1',
  operation: 'create',
  payload: { total: 300 },
  createdAt: '2026-01-01T00:00:00.000Z',
  attempts: 0
}

function clientWith(status: number): {
  client: ReturnType<typeof createSyncClient>
  fetchMock: ReturnType<typeof vi.fn>
} {
  const fetchMock = vi.fn(async () => new Response(null, { status }))
  return {
    client: createSyncClient('http://api.test', fetchMock as unknown as FetchLike),
    fetchMock
  }
}

describe('createSyncClient', () => {
  it('POSTs the envelope to /api/sync and resolves on 2xx', async () => {
    const { client, fetchMock } = clientWith(200)
    await expect(client.push(item)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api.test/api/sync')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      id: 'q1',
      entityType: 'sale',
      entityId: 's1',
      operation: 'create',
      payload: { total: 300 },
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('throws a retryable error on 5xx / 401 / 408 / 429', async () => {
    // 401 = this terminal's token is not accepted (revoked / re-coded): keep the
    // queue intact until it is enrolled again.
    for (const status of [500, 503, 401, 408, 429]) {
      const { client } = clientWith(status)
      await expect(client.push(item)).rejects.toMatchObject({ retryable: true, status })
    }
  })

  it('throws a non-retryable error on other 4xx', async () => {
    for (const status of [400, 403, 422]) {
      const { client } = clientWith(status)
      await expect(client.push(item)).rejects.toMatchObject({ retryable: false, status })
    }
  })

  it('sends the terminal token once the runtime has set it', async () => {
    setTerminalToken('tok-123')
    const { client, fetchMock } = clientWith(200)
    await client.push(item)
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Terminal-Token']).toBe('tok-123')
    setTerminalToken(null)
  })

  it('treats a network failure as retryable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const client = createSyncClient('http://api.test', fetchMock as unknown as FetchLike)
    await expect(client.push(item)).rejects.toBeInstanceOf(SyncError)
    await expect(client.push(item)).rejects.toMatchObject({ retryable: true, status: undefined })
  })
})
