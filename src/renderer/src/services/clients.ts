/** "A cuenta" clients on the backend (HTTP) — backoffice "Clientes". */
import { apiFetch } from './http'

export interface ClientSummary {
  id: string
  name: string
  detail: string | null
  phone: string | null
  active: boolean
  createdByName: string | null
  createdAt: string
  creditCents: number
  paidCents: number
  /** What the client owes now (credit sales − payments). */
  balanceCents: number
  lastMovementAt: string | null
}

export interface ClientAccountMovement {
  kind: 'credit_sale' | 'payment'
  id: string
  reference: string
  terminalId: string
  amountCents: number
  cashCents: number
  cardCents: number
  userName: string | null
  createdAt: string
}

export interface ClientInput {
  name: string
  detail: string | null
  phone: string | null
  active: boolean
}

export function listClientSummaries(): Promise<ClientSummary[]> {
  return apiFetch<ClientSummary[]>('/api/clients')
}

export function clientMovements(id: string): Promise<ClientAccountMovement[]> {
  return apiFetch<ClientAccountMovement[]>(`/api/clients/${id}/movements`)
}

export function createClientOnServer(body: ClientInput): Promise<void> {
  return apiFetch<void>('/api/clients', { method: 'POST', body: JSON.stringify(body) })
}

export function updateClientOnServer(id: string, body: ClientInput): Promise<void> {
  return apiFetch<void>(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}
