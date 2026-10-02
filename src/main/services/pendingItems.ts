import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { PendingItem, ResolvePendingRequest } from '../../shared/types'
import {
  getPendingItem,
  listOpenPendingItems,
  resolvePendingItem
} from '../repositories/pendingItems'
import { recordAuditEvent } from '../repositories/auditEvents'

/** Lines sold without a catalog product that still need completing. */
export function listPendingItems(db: DB): PendingItem[] {
  return listOpenPendingItems(db)
}

function resolve(
  db: DB,
  terminalId: string,
  req: ResolvePendingRequest,
  status: 'completed' | 'dismissed',
  now: Date
): PendingItem {
  const txn = db.transaction((): PendingItem => {
    const item = getPendingItem(db, req.id)
    if (!item) throw new Error('Pendiente no encontrado')
    if (item.status !== 'pending') throw new Error('Este pendiente ya está resuelto')
    resolvePendingItem(db, req.id, status, req.productId ?? null, now.toISOString(), req.actor)
    const resolved = getPendingItem(db, req.id)!
    // Same entity, newer snapshot: the backend upserts it and, on completion,
    // links the sale lines to the new product.
    db.prepare(
      `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
       VALUES (?, 'pending_item', ?, 'update', ?)`
    ).run(uuidv7(), resolved.id, JSON.stringify(resolved))
    recordAuditEvent(db, {
      type: status === 'completed' ? 'pending_item.completed' : 'pending_item.dismissed',
      terminalId,
      actor: req.actor,
      entityId: resolved.id,
      occurredAt: now,
      data: {
        kind: resolved.kind,
        barcode: resolved.barcode,
        priceCents: resolved.priceCents,
        ticketNumber: resolved.ticketNumber,
        productId: resolved.productId,
        createdByName: resolved.createdByName
      }
    })
    return resolved
  })
  return txn.immediate()
}

/** The real product was created for this pending line: link it and close it. */
export function completePendingItem(
  db: DB,
  terminalId: string,
  req: ResolvePendingRequest,
  now: Date = new Date()
): PendingItem {
  if (!req.productId) throw new Error('Falta el producto creado')
  return resolve(db, terminalId, req, 'completed', now)
}

/** Drop a pending line without creating a product (it stays in the audit log). */
export function dismissPendingItem(
  db: DB,
  terminalId: string,
  req: ResolvePendingRequest,
  now: Date = new Date()
): PendingItem {
  return resolve(db, terminalId, { ...req, productId: undefined }, 'dismissed', now)
}
