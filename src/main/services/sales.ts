import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { CreateSaleRequest, Sale } from '../../shared/types'

/** Zero-pads the per-terminal/year sequence to the ticket number format. */
function formatTicketNumber(terminalId: string, year: number, sequence: number): string {
  return `${terminalId}-${year}-${String(sequence).padStart(5, '0')}`
}

/**
 * Creates a sale and its sync-queue entry in a single atomic transaction.
 *
 * The ticket sequence is derived from MAX(ticket_sequence)+1 scoped to
 * (terminal_id, year). Because better-sqlite3 runs synchronously in the Main
 * process and the transaction is IMMEDIATE (takes the write lock up front),
 * concurrent calls can't read the same MAX and collide. The
 * UNIQUE(terminal_id, ticket_year, ticket_sequence) constraint is the final
 * backstop — a colliding INSERT throws rather than issuing a duplicate ticket.
 *
 * Every sale also enqueues a `sync_queue` row in the same transaction, so a
 * persisted sale can never exist without a pending sync record.
 */
export function createSale(db: DB, terminalId: string, input: CreateSaleRequest): Sale {
  const year = new Date().getFullYear()
  const totalCents = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0)

  const payment = input.payment
  const paid = payment.cashCents + payment.cardCents + payment.creditCents
  if (paid !== totalCents) {
    throw new Error(`Payment (${paid}) does not match the sale total (${totalCents})`)
  }

  const nextSequenceStmt = db.prepare<[string, number], { next: number }>(
    `SELECT COALESCE(MAX(ticket_sequence), 0) + 1 AS next
       FROM sales
      WHERE terminal_id = ? AND ticket_year = ?`
  )
  const insertSaleStmt = db.prepare(
    `INSERT INTO sales
       (id, ticket_number, terminal_id, ticket_year, ticket_sequence, total_cents, items_json,
        cash_cents, card_cents, credit_cents, client_id)
     VALUES (@id, @ticketNumber, @terminalId, @year, @sequence, @totalCents, @itemsJson,
        @cashCents, @cardCents, @creditCents, @clientId)`
  )
  const insertSyncStmt = db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (@id, 'sale', @entityId, 'create', @payload)`
  )
  const selectCreatedAtStmt = db.prepare<[string], { created_at: string }>(
    'SELECT created_at FROM sales WHERE id = ?'
  )

  const txn = db.transaction((): Sale => {
    const { next: sequence } = nextSequenceStmt.get(terminalId, year)!
    const id = uuidv7()
    const ticketNumber = formatTicketNumber(terminalId, year, sequence)

    insertSaleStmt.run({
      id,
      ticketNumber,
      terminalId,
      year,
      sequence,
      totalCents,
      itemsJson: JSON.stringify(input.items),
      cashCents: payment.cashCents,
      cardCents: payment.cardCents,
      creditCents: payment.creditCents,
      clientId: payment.clientId
    })

    const { created_at: createdAt } = selectCreatedAtStmt.get(id)!

    const record: Sale = {
      id,
      ticketNumber,
      terminalId,
      year,
      sequence,
      totalCents,
      createdAt,
      payment
    }

    insertSyncStmt.run({
      id: uuidv7(),
      entityId: id,
      payload: JSON.stringify({ ...record, items: input.items })
    })

    return record
  })

  // IMMEDIATE: grab the write lock before computing the next sequence.
  return txn.immediate()
}
