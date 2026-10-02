import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { CartItemInput, CreateSaleRequest, Sale } from '../../shared/types'
import { getSessionById } from '../repositories/cashSessions'
import { insertPendingItem } from '../repositories/pendingItems'
import { recordAuditEvent } from '../repositories/auditEvents'

/** A sale line as stored/synced: manual lines carry the id of their pending item. */
type StoredItem = CartItemInput & { pendingItemId?: string }

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
 *
 * Lines rung without a catalog product ("Producto" (no barcode) / barcode not found)
 * each create a pending item — to be completed into a real product later — and
 * the sale is recorded in the audit log, all in the same transaction.
 */
export function createSale(db: DB, terminalId: string, input: CreateSaleRequest): Sale {
  const year = new Date().getFullYear()
  const totalCents = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0)

  const payment = input.payment
  const paid = payment.cashCents + payment.cardCents + payment.creditCents
  if (paid !== totalCents) {
    throw new Error(`Payment (${paid}) does not match the sale total (${totalCents})`)
  }

  // A sale must belong to an OPEN caja (cash session) — no open caja, no sale. The
  // seller is the logged-in user, not the caja's opener: several people (the next
  // shift, a reinforcement) can ring sales into the same caja.
  const session = getSessionById(db, input.cashSessionId)
  if (!session || session.status !== 'open') {
    throw new Error('No hay una caja abierta para registrar la venta')
  }

  const nextSequenceStmt = db.prepare<[string, number], { next: number }>(
    `SELECT COALESCE(MAX(ticket_sequence), 0) + 1 AS next
       FROM sales
      WHERE terminal_id = ? AND ticket_year = ?`
  )
  const insertSaleStmt = db.prepare(
    `INSERT INTO sales
       (id, ticket_number, terminal_id, ticket_year, ticket_sequence, total_cents, items_json,
        cash_cents, card_cents, credit_cents, client_id, client_name,
        cash_session_id, cashier_user_id, cashier_name)
     VALUES (@id, @ticketNumber, @terminalId, @year, @sequence, @totalCents, @itemsJson,
        @cashCents, @cardCents, @creditCents, @clientId, @clientName,
        @cashSessionId, @cashierUserId, @cashierName)`
  )
  const insertSyncStmt = db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (@id, 'sale', @entityId, 'create', @payload)`
  )
  const insertPendingSyncStmt = db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'pending_item', ?, 'create', ?)`
  )
  const selectCreatedAtStmt = db.prepare<[string], { created_at: string }>(
    'SELECT created_at FROM sales WHERE id = ?'
  )

  const txn = db.transaction((): Sale => {
    const { next: sequence } = nextSequenceStmt.get(terminalId, year)!
    const id = uuidv7()
    const ticketNumber = formatTicketNumber(terminalId, year, sequence)
    const items: StoredItem[] = input.items.map((item) =>
      item.manual ? { ...item, productId: null, pendingItemId: uuidv7() } : item
    )

    insertSaleStmt.run({
      id,
      ticketNumber,
      terminalId,
      year,
      sequence,
      totalCents,
      itemsJson: JSON.stringify(items),
      cashCents: payment.cashCents,
      cardCents: payment.cardCents,
      creditCents: payment.creditCents,
      clientId: payment.clientId,
      clientName: payment.creditCents !== 0 ? payment.clientName : null,
      cashSessionId: session.id,
      cashierUserId: input.sellerUserId,
      cashierName: input.sellerName
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
      payload: JSON.stringify({
        ...record,
        items,
        cashSessionId: session.id,
        cashierUserId: input.sellerUserId,
        cashierName: input.sellerName
      })
    })

    const seller = { userId: input.sellerUserId, name: input.sellerName }
    let manualLines = 0
    for (const item of items) {
      if (!item.manual || !item.pendingItemId) continue
      manualLines += 1
      const pending = {
        id: item.pendingItemId,
        terminalId,
        saleId: id,
        ticketNumber,
        kind: item.manual.kind,
        barcode: item.manual.barcode,
        name: item.manual.name,
        categoryId: item.manual.categoryId,
        priceCents: item.unitPriceCents,
        quantity: item.quantity,
        createdAt,
        createdByUserId: seller.userId,
        createdByName: seller.name
      }
      insertPendingItem(db, pending)
      insertPendingSyncStmt.run(
        uuidv7(),
        pending.id,
        JSON.stringify({ ...pending, status: 'pending' })
      )
    }

    recordAuditEvent(db, {
      type: 'sale.completed',
      terminalId,
      actor: seller,
      cashSessionId: session.id,
      entityId: id,
      occurredAt: new Date(createdAt),
      data: {
        draftId: input.draftId ?? null,
        ticketNumber,
        totalCents,
        lines: items.length,
        units: items.reduce((n, i) => n + i.quantity, 0),
        manualLines,
        cashCents: payment.cashCents,
        cardCents: payment.cardCents,
        creditCents: payment.creditCents
      }
    })

    return record
  })

  // IMMEDIATE: grab the write lock before computing the next sequence.
  return txn.immediate()
}
