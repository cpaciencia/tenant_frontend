import { describe, it, expect, vi } from 'vitest'
import { createEnrollmentClient, EnrollmentError, type FetchLike } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('enrollment client', () => {
  it('enrols and returns the issued credentials', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ terminalId: 'T01', token: 'tok-123', dbKey: 'key-abc' })
      ) as unknown as FetchLike
    const client = createEnrollmentClient(fetchFn)

    const creds = await client.enroll('http://host:8080/', 'T01', 'ABCD2345')

    expect(creds).toEqual({ terminalId: 'T01', token: 'tok-123', dbKey: 'key-abc' })
    // Trailing slash normalised, body shaped to the backend contract.
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://host:8080/api/terminals/enroll')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      terminalId: 'T01',
      enrollmentCode: 'ABCD2345'
    })
  })

  it('maps a 401 to a friendly message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 401)) as unknown as FetchLike
    const client = createEnrollmentClient(fetchFn)
    await expect(client.enroll('http://h', 'T01', 'WRONG')).rejects.toMatchObject({
      name: 'EnrollmentError',
      status: 401
    })
  })

  it('rejects an incomplete response body', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ terminalId: 'T01' })) as unknown as FetchLike
    const client = createEnrollmentClient(fetchFn)
    await expect(client.enroll('http://h', 'T01', 'X')).rejects.toBeInstanceOf(EnrollmentError)
  })

  it('wraps a network failure as a non-status EnrollmentError', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as FetchLike
    const client = createEnrollmentClient(fetchFn)
    await expect(client.enroll('http://h', 'T01', 'X')).rejects.toMatchObject({
      name: 'EnrollmentError',
      status: undefined
    })
  })

  it('reports reachability: any response is up, a throw is down', async () => {
    const up = createEnrollmentClient(
      vi.fn().mockResolvedValue(jsonResponse([])) as unknown as FetchLike
    )
    const down = createEnrollmentClient(
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as FetchLike
    )
    expect(await up.testConnection('http://h')).toBe(true)
    expect(await down.testConnection('http://h')).toBe(false)
  })
})
