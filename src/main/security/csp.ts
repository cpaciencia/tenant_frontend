import { session } from 'electron'

/**
 * Content-Security-Policy for the renderer. The renderer talks HTTP to the cloud
 * backend for the shared management screens (users/roles/permissions), so
 * `connect-src` must allow that origin in addition to `'self'`. The backend URL
 * is per-terminal (set at enrolment), so the policy is built dynamically and
 * served as a response header from Main — the single source of truth (the static
 * `<meta>` was removed so it can't intersect to a stricter policy).
 */

const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: = invoice files downloaded with the session token and previewed in-app.
  "img-src 'self' data: blob:",
  // Bundled fonts (Lato, Playfair, PrimeIcons) are inlined by Vite as data: URIs
  // in the production build; without this they're blocked and the UI falls back
  // to system fonts and loses its icons.
  "font-src 'self' data:"
]

/** Extract the scheme://host:port origin of a URL, or null if it can't be parsed. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Build the CSP string, whitelisting the backend origin for `connect-src`. */
export function buildCsp(syncApiUrl: string): string {
  const backend = originOf(syncApiUrl)
  const connectSrc = backend ? `connect-src 'self' ${backend}` : "connect-src 'self'"
  return [...BASE_DIRECTIVES, connectSrc].join('; ')
}

/**
 * Install the CSP header on every response in the default session. Reads the
 * backend URL lazily so it always reflects the current enrolment.
 */
export function installCsp(getSyncApiUrl: () => string): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp(getSyncApiUrl())]
      }
    })
  })
}
