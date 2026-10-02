import type { DB } from '../db/connection'
import type {
  CashMovement,
  CashMovementKind,
  CashMovementsSummary,
  InvoiceStatus
} from '../../shared/types'

interface MovementRow {
  id: string
  terminal_id: string
  cash_session_id: string
  kind: string
  amount_cents: number
  supplier_id: string | null
  supplier: string | null
  document: string | null
  note: string | null
  user_id: string | null
  user_name: string
  created_at: string
  invoice_status: string | null
  invoice_file_name: string | null
  invoice_uploaded_at: string | null
}

function mapRow(r: MovementRow): CashMovement {
  return {
    id: r.id,
    cashSessionId: r.cash_session_id,
    terminalId: r.terminal_id,
    kind: r.kind as CashMovementKind,
    amountCents: r.amount_cents,
    supplierId: r.supplier_id,
    supplier: r.supplier,
    document: r.document,
    note: r.note,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
    invoiceStatus: r.invoice_status as InvoiceStatus | null,
    invoiceFileName: r.invoice_file_name,
    invoiceUploadedAt: r.invoice_uploaded_at
  }
}

export function insertCashMovement(db: DB, m: CashMovement): void {
  db.prepare(
    `INSERT INTO cash_movements
       (id, terminal_id, cash_session_id, kind, amount_cents, supplier_id, supplier, document,
        note, user_id, user_name, created_at, invoice_status, invoice_file_name,
        invoice_uploaded_at)
     VALUES (@id, @terminalId, @cashSessionId, @kind, @amountCents, @supplierId, @supplier,
        @document, @note, @userId, @userName, @createdAt, @invoiceStatus, @invoiceFileName,
        @invoiceUploadedAt)`
  ).run({ ...m })
}

export function listCashMovements(db: DB, cashSessionId: string): CashMovement[] {
  const rows = db
    .prepare('SELECT * FROM cash_movements WHERE cash_session_id = ? ORDER BY created_at')
    .all(cashSessionId) as MovementRow[]
  return rows.map(mapRow)
}

/** Totals per kind and the money put in still to be taken out. */
export function summarizeCashMovements(list: CashMovement[]): CashMovementsSummary {
  const sum = (kind: CashMovementKind): number =>
    list.filter((m) => m.kind === kind).reduce((n, m) => n + m.amountCents, 0)
  const cashInCents = sum('cash_in')
  const cashOutCents = sum('cash_out')
  return {
    cashInCents,
    cashOutCents,
    supplierPaymentsCents: sum('supplier_payment'),
    otherPaymentsCents: sum('other_payment'),
    cashInPendingCents: Math.max(0, cashInCents - cashOutCents),
    invoicesPending: list.filter((m) => m.invoiceStatus === 'pending').length,
    list
  }
}

/** Net effect of the movements on the cash in the drawer. */
export function drawerEffectCents(summary: CashMovementsSummary): number {
  return (
    summary.cashInCents -
    summary.supplierPaymentsCents -
    summary.otherPaymentsCents -
    summary.cashOutCents
  )
}

export function getCashMovement(db: DB, id: string): CashMovement | null {
  const row = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(id) as
    | MovementRow
    | undefined
  return row ? mapRow(row) : null
}

/** Supplier payments of a caja still waiting for their invoice. */
export function countPendingInvoices(db: DB, cashSessionId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cash_movements
          WHERE cash_session_id = ? AND invoice_status = 'pending'`
      )
      .get(cashSessionId) as { n: number }
  ).n
}
