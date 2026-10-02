/** Internal consumption on the backend (HTTP) — backoffice "Consumo interno". */
import { apiFetch } from './http'

export interface InternalAccountInfo {
  id: string
  name: string
  active: boolean
  updatedAt: string
}

export interface ConsumptionLine {
  productId: string | null
  name: string
  quantity: number
  unitPriceCents: number
  unitCostCents: number
}

export interface ConsumptionRecord {
  id: string
  consumptionNumber: string
  terminalId: string
  accountName: string
  takenByName: string
  reason: string | null
  totalCents: number
  costCents: number
  userName: string | null
  createdAt: string
  lines: ConsumptionLine[]
}

export function listInternalAccountsOnServer(): Promise<InternalAccountInfo[]> {
  return apiFetch<InternalAccountInfo[]>('/api/internal-accounts')
}

export function createInternalAccount(name: string): Promise<InternalAccountInfo> {
  return apiFetch<InternalAccountInfo>('/api/internal-accounts', {
    method: 'POST',
    body: JSON.stringify({ name })
  })
}

export function updateInternalAccount(
  id: string,
  name: string,
  active: boolean
): Promise<InternalAccountInfo> {
  return apiFetch<InternalAccountInfo>(`/api/internal-accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, active })
  })
}

export function listConsumptions(from: string, to: string): Promise<ConsumptionRecord[]> {
  return apiFetch<ConsumptionRecord[]>(`/api/internal-consumptions?from=${from}&to=${to}`)
}
