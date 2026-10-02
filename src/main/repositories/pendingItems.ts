import type { DB } from '../db/connection'
import type { ManualItemKind, PendingItem } from '../../shared/types'

interface PendingRow {
  id: string
  terminal_id: string
  sale_id: string
  ticket_number: string
  kind: string
  barcode: string | null
  name: string | null
  category_id: string | null
  price_cents: number
  quantity: number
  created_at: string
  created_by_user_id: string | null
  created_by_name: string
  status: string
  product_id: string | null
  resolved_at: string | null
  resolved_by_user_id: string | null
  resolved_by_name: string | null
}

function mapRow(r: PendingRow): PendingItem {
  return {
    id: r.id,
    terminalId: r.terminal_id,
    saleId: r.sale_id,
    ticketNumber: r.ticket_number,
    kind: r.kind === 'not_found' ? 'not_found' : 'quick',
    barcode: r.barcode,
    name: r.name,
    categoryId: r.category_id,
    priceCents: r.price_cents,
    quantity: r.quantity,
    createdAt: r.created_at,
    createdByUserId: r.created_by_user_id,
    createdByName: r.created_by_name,
    status: r.status === 'completed' || r.status === 'dismissed' ? r.status : 'pending',
    productId: r.product_id,
    resolvedAt: r.resolved_at,
    resolvedByUserId: r.resolved_by_user_id,
    resolvedByName: r.resolved_by_name
  }
}

export interface InsertPendingInput {
  id: string
  terminalId: string
  saleId: string
  ticketNumber: string
  kind: ManualItemKind
  barcode: string | null
  name: string | null
  categoryId: string | null
  priceCents: number
  quantity: number
  createdAt: string
  createdByUserId: string | null
  createdByName: string
}

export function insertPendingItem(db: DB, p: InsertPendingInput): void {
  db.prepare(
    `INSERT INTO pending_items
       (id, terminal_id, sale_id, ticket_number, kind, barcode, name, category_id, price_cents,
        quantity, created_at, created_by_user_id, created_by_name)
     VALUES (@id, @terminalId, @saleId, @ticketNumber, @kind, @barcode, @name, @categoryId,
        @priceCents, @quantity, @createdAt, @createdByUserId, @createdByName)`
  ).run(p)
}

export function getPendingItem(db: DB, id: string): PendingItem | null {
  const row = db.prepare('SELECT * FROM pending_items WHERE id = ?').get(id) as
    | PendingRow
    | undefined
  return row ? mapRow(row) : null
}

/** Items still waiting to be completed or dismissed, oldest first. */
export function listOpenPendingItems(db: DB): PendingItem[] {
  const rows = db
    .prepare(`SELECT * FROM pending_items WHERE status = 'pending' ORDER BY created_at`)
    .all() as PendingRow[]
  return rows.map(mapRow)
}

export function resolvePendingItem(
  db: DB,
  id: string,
  status: 'completed' | 'dismissed',
  productId: string | null,
  resolvedAt: string,
  by: { userId: string | null; name: string }
): boolean {
  const result = db
    .prepare(
      `UPDATE pending_items
          SET status = ?, product_id = ?, resolved_at = ?, resolved_by_user_id = ?, resolved_by_name = ?
        WHERE id = ? AND status = 'pending'`
    )
    .run(status, productId, resolvedAt, by.userId, by.name, id)
  return result.changes === 1
}
