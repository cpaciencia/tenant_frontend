/**
 * The terminal's credential towards the backend: the sync token issued at
 * enrolment. Sent on every terminal-facing call (sync push, catalog/user pulls)
 * so the backend only serves enrolled, non-revoked terminals. Set once by
 * `startRuntime`; never exposed to the renderer.
 */
let terminalToken: string | null = null

export const TERMINAL_TOKEN_HEADER = 'X-Terminal-Token'

export function setTerminalToken(token: string | null): void {
  terminalToken = token
}

export function terminalAuthHeaders(): Record<string, string> {
  return terminalToken ? { [TERMINAL_TOKEN_HEADER]: terminalToken } : {}
}
