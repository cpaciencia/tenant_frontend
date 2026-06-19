export type FetchLike = typeof fetch

/** Credentials issued by the backend when an enrolment code is redeemed. */
export interface IssuedCredentials {
  terminalId: string
  token: string
  dbKey: string
}

/** Error carrying the backend's message so the UI can show why enrolment failed. */
export class EnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined
  ) {
    super(message)
    this.name = 'EnrollmentError'
  }
}

export interface EnrollmentClient {
  enroll: (baseUrl: string, terminalId: string, code: string) => Promise<IssuedCredentials>
  testConnection: (baseUrl: string) => Promise<boolean>
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Talks to the terminal-enrolment endpoints. `fetchFn` is injectable for tests.
 * `testConnection` is a reachability probe: any HTTP response counts as "up";
 * only a network-level failure (or timeout) counts as "down".
 */
export function createEnrollmentClient(fetchFn: FetchLike = fetch): EnrollmentClient {
  return {
    async enroll(baseUrl, terminalId, code) {
      const endpoint = `${normalizeBase(baseUrl)}/api/terminals/enroll`
      let response: Response
      try {
        response = await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminalId, enrollmentCode: code })
        })
      } catch (cause) {
        throw new EnrollmentError(`No se pudo conectar con el backend (${String(cause)})`, undefined)
      }

      if (!response.ok) {
        throw new EnrollmentError(await describeError(response), response.status)
      }

      const body = (await response.json()) as Partial<IssuedCredentials>
      if (!body.token || !body.dbKey || !body.terminalId) {
        throw new EnrollmentError('Respuesta de enrolamiento incompleta', response.status)
      }
      return { terminalId: body.terminalId, token: body.token, dbKey: body.dbKey }
    },

    async testConnection(baseUrl) {
      // Hit a cheap endpoint with a far-future watermark (empty result) just to
      // see if the host answers at all.
      const endpoint = `${normalizeBase(baseUrl)}/api/users?since=9999-01-01T00:00:00Z`
      try {
        await fetchFn(endpoint, { method: 'GET', signal: AbortSignal.timeout(5000) })
        return true
      } catch {
        return false
      }
    }
  }
}

/** Map common statuses to friendly Spanish messages; fall back to the body. */
async function describeError(response: Response): Promise<string> {
  if (response.status === 401) return 'Código o terminal incorrectos.'
  if (response.status === 403) return 'Este terminal está revocado.'
  if (response.status === 409) return 'El terminal ya está enrolado; genera un nuevo código.'
  const text = await response.text().catch(() => '')
  return text || `Error del backend (HTTP ${response.status}).`
}