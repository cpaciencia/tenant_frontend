/**
 * Tiny fetch wrapper shared by web and (online) desktop. Centralises the backend
 * base URL, attaches the Bearer token, and turns non-2xx responses into thrown
 * errors with the backend's message. The data LAYER differs per target, but when
 * a target talks HTTP to the cloud backend it goes through here.
 */

let baseUrl = ''
let getToken: () => string | null = () => null

// The desktop learns its backend URL asynchronously (from the enrolment state);
// callers that run at boot can wait for it instead of racing it.
let markConfigured: () => void = () => {}
const configured = new Promise<void>((resolve) => (markConfigured = resolve))

/** Resolves once `configureHttp` has run at least once. */
export function whenHttpConfigured(): Promise<void> {
  return configured
}

export function configureHttp(opts: { baseUrl: string; getToken?: () => string | null }): void {
  baseUrl = opts.baseUrl.replace(/\/+$/, '')
  if (opts.getToken) getToken = opts.getToken
  markConfigured()
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  // Let the browser set the multipart boundary for FormData; only default JSON.
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
  if (!res.ok) {
    throw new HttpError(res.status, await extractError(res))
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

async function extractError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body && typeof body.message === 'string' && body.message) return body.message
  } catch {
    // not JSON
  }
  if (res.status === 401) return 'No autorizado'
  if (res.status === 403) return 'No tienes permiso para esta acción'
  return `Error ${res.status}`
}

/** Like `apiFetch` but for a binary download (e.g. an invoice file). */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken()
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new HttpError(res.status, await extractError(res))
  return res.blob()
}
