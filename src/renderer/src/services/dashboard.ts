/** Backoffice "Resumen" (owner's dashboard) over the backend analytics layer. */
import { apiFetch } from './http'

export interface DashboardBucket {
  label: string
  cents: number
  count: number
}

export interface DashboardSummary {
  from: string
  to: string
  totals: {
    salesCents: number
    tickets: number
    avgTicketCents: number
    cashCents: number
    cardCents: number
    creditCents: number
    marginCents: number
    linesWithoutCost: number
  }
  byDay: DashboardBucket[]
  byHour: DashboardBucket[]
  byGroup: DashboardBucket[]
  bySeller: DashboardBucket[]
  topProducts: { name: string; units: number; cents: number }[]
  alerts: {
    clientsOwedCents: number
    clientsOwing: number
    debtCollectedCents: number
    internalConsumptionCostCents: number
    paymentsWithoutInvoiceCents: number
    supplierInvoicesMissing: number
    cierresDifferenceCents: number
    cierresWithDifference: number
    pendingItems: number
  }
}

export function getDashboard(from: string, to: string): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/api/dashboard?from=${from}&to=${to}`)
}
