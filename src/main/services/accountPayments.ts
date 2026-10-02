import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type {
  AccountPayment,
  Actor,
  SettleDebtRequest,
  SettlementsSummary
} from '../../shared/types'
import { getOpenSessions } from '../repositories/cashSessions'
import { getClient } from '../repositories/clients'
import { recordAuditEvent } from '../repositories/auditEvents'

interface PaymentRow {
  id: string
  payment_number: string
  terminal_id: string
  client_id: string
  client_name: string
  cash_cents: number
  card_cents: number
  total_cents: number
  cash_session_id: string
  sale_id: string | null
  user_id: string | null
  user_name: string
  note: string | null
  created_at: string
}

function mapRow(r: PaymentRow): AccountPayment {
  return {
    id: r.id,
    paymentNumber: r.payment_number,
    terminalId: r.terminal_id,
    clientId: r.client_id,
    clientName: r.client_name,
    cashCents: r.cash_cents,
    cardCents: r.card_cents,
    totalCents: r.total_cents,
    cashSessionId: r.cash_session_id,
    saleId: r.sale_id,
    userId: r.user_id,
    userName: r.user_name,
    note: r.note,
    createdAt: r.created_at
  }
}

/** `CC-T01-2026-00001` — its own series: a debt payment is not a ticket. */
export function formatPaymentNumber(terminalId: string, year: number, sequence: number): string {
  return `CC-${terminalId}-${year}-${String(sequence).padStart(5, '0')}`
}

export interface PaymentInput {
  clientId: string
  cashCents: number
  cardCents: number
  note?: string | null
  actor: Actor
  saleId?: string | null
}

/**
 * Record a debt payment in a caja. Must run inside the caller's transaction (alone
 * or together with a sale). Validates: client exists, amount > 0, no more than
 * what the client owes. Synced and audited.
 */
export function insertPaymentInTxn(
  db: DB,
  terminalId: string,
  cashSessionId: string,
  input: PaymentInput,
  now: Date
): AccountPayment {
  const cashCents = Math.round(input.cashCents)
  const cardCents = Math.round(input.cardCents)
  if (![cashCents, cardCents].every(Number.isFinite) || cashCents < 0 || cardCents < 0) {
    throw new Error('Importe no válido')
  }
  const totalCents = cashCents + cardCents
  if (totalCents <= 0) throw new Error('El importe debe ser mayor que 0')
  const client = getClient(db, input.clientId)
  if (!client) throw new Error('Cliente no encontrado')
  if (totalCents > client.balanceCents) {
    throw new Error('El importe es mayor que lo que debe el cliente')
  }

  const year = now.getFullYear()
  const { next } = db
    .prepare(
      `SELECT COALESCE(MAX(payment_sequence), 0) + 1 AS next
         FROM account_payments WHERE terminal_id = ? AND payment_year = ?`
    )
    .get(terminalId, year) as { next: number }
  const payment: AccountPayment = {
    id: uuidv7(),
    paymentNumber: formatPaymentNumber(terminalId, year, next),
    terminalId,
    clientId: client.id,
    clientName: client.name,
    cashCents,
    cardCents,
    totalCents,
    cashSessionId,
    saleId: input.saleId ?? null,
    userId: input.actor.userId,
    userName: input.actor.name,
    note: input.note?.trim() || null,
    createdAt: now.toISOString()
  }
  db.prepare(
    `INSERT INTO account_payments
       (id, payment_number, terminal_id, payment_year, payment_sequence, client_id, client_name,
        cash_cents, card_cents, total_cents, cash_session_id, sale_id, user_id, user_name, note,
        created_at)
     VALUES (@id, @paymentNumber, @terminalId, @year, @sequence, @clientId, @clientName,
        @cashCents, @cardCents, @totalCents, @cashSessionId, @saleId, @userId, @userName, @note,
        @createdAt)`
  ).run({ ...payment, year, sequence: next })
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'account_payment', ?, 'create', ?)`
  ).run(uuidv7(), payment.id, JSON.stringify(payment))
  recordAuditEvent(db, {
    type: 'account.payment',
    terminalId,
    actor: input.actor,
    cashSessionId,
    entityId: payment.id,
    occurredAt: now,
    data: {
      paymentNumber: payment.paymentNumber,
      clientId: client.id,
      clientName: client.name,
      cashCents,
      cardCents,
      totalCents,
      balanceBeforeCents: client.balanceCents,
      balanceAfterCents: client.balanceCents - totalCents,
      withSale: payment.saleId !== null
    }
  })
  return payment
}

/** A client pays (part of) their debt at the till, without a purchase. */
export function settleDebt(
  db: DB,
  terminalId: string,
  req: SettleDebtRequest,
  now: Date = new Date()
): AccountPayment {
  const txn = db.transaction((): AccountPayment => {
    const session = getOpenSessions(db, terminalId)[0]
    if (!session) throw new Error('No hay ninguna caja abierta')
    return insertPaymentInTxn(db, terminalId, session.id, req, now)
  })
  return txn.immediate()
}

export function listSessionPayments(db: DB, cashSessionId: string): AccountPayment[] {
  return (
    db
      .prepare('SELECT * FROM account_payments WHERE cash_session_id = ? ORDER BY created_at')
      .all(cashSessionId) as PaymentRow[]
  ).map(mapRow)
}

export function summarizeSettlements(list: AccountPayment[]): SettlementsSummary {
  return {
    cashCents: list.reduce((n, p) => n + p.cashCents, 0),
    cardCents: list.reduce((n, p) => n + p.cardCents, 0),
    totalCents: list.reduce((n, p) => n + p.totalCents, 0),
    list
  }
}
