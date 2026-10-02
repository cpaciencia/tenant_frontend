/** Tills ("puestos") on the backend — backoffice "Puestos" screen. */
import { apiFetch } from './http'

export type TerminalStatus = 'pending' | 'enrolled' | 'revoked'

export interface TerminalInfo {
  terminalId: string
  name: string | null
  status: TerminalStatus
  hasPendingCode: boolean
  enrolledAt: string | null
  createdAt: string
}

export interface TerminalCode {
  terminalId: string
  name: string | null
  enrollmentCode: string
}

export function listTerminals(): Promise<TerminalInfo[]> {
  return apiFetch<TerminalInfo[]>('/api/terminals')
}

export function registerTerminal(terminalId: string, name: string): Promise<TerminalCode> {
  return apiFetch<TerminalCode>('/api/terminals', {
    method: 'POST',
    body: JSON.stringify({ terminalId, name })
  })
}

export function resetTerminalCode(terminalId: string): Promise<TerminalCode> {
  return apiFetch<TerminalCode>(`/api/terminals/${encodeURIComponent(terminalId)}/reset-code`, {
    method: 'POST'
  })
}

export function revokeTerminal(terminalId: string): Promise<void> {
  return apiFetch<void>(`/api/terminals/${encodeURIComponent(terminalId)}/revoke`, {
    method: 'POST'
  })
}
