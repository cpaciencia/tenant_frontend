import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type {
  CashMovement,
  CashMovementKind,
  CashMovementsSummary,
  MarkInvoiceUploadedRequest,
  RecordCashMovementRequest
} from '../../shared/types'
import { getOpenSessions } from '../repositories/cashSessions'
import {
  getCashMovement,
  insertCashMovement,
  listCashMovements,
  summarizeCashMovements
} from '../repositories/cashMovements'
import { findOrCreateSupplier, getSupplier } from '../repositories/suppliers'
import { recordAuditEvent } from '../repositories/auditEvents'

const KINDS: CashMovementKind[] = ['supplier_payment', 'other_payment', 'cash_in', 'cash_out']

/**
 * Record cash moved in/out of the drawer that is not a sale (supplier payment,
 * money put in or taken out) in the terminal's open caja: synced
 * and audited in the same transaction. Must run inside a transaction when called
 * from another operation (e.g. taking money out at close).
 */
export function insertMovementInTxn(
  db: DB,
  terminalId: string,
  cashSessionId: string,
  req: RecordCashMovementRequest,
  now: Date
): CashMovement {
  if (!KINDS.includes(req.kind)) throw new Error('Tipo de movimiento desconocido')
  const amountCents = Math.round(req.amountCents)
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    throw new Error('El importe debe ser mayor que 0')
  // A supplier payment names a supplier from the list (or adds it) and needs its
  // invoice stored on the server before the caja can be closed.
  let supplierId: string | null = null
  let supplier: string | null = null
  if (req.kind === 'supplier_payment') {
    const picked = req.supplierId ? getSupplier(db, req.supplierId) : null
    const name = picked?.name ?? req.supplier?.trim()
    if (!name) throw new Error('Indica el proveedor')
    const resolved = picked ?? findOrCreateSupplier(db, name, req.actor.name, now)
    supplierId = resolved.id
    supplier = resolved.name
  } else if (req.kind === 'other_payment') {
    // No invoice exists for these, so who was paid and what for are mandatory.
    supplier = req.supplier?.trim() || null
    if (!supplier) throw new Error('Indica a quién se paga')
    if (!req.note?.trim()) throw new Error('Indica el concepto del pago')
  }
  const movement: CashMovement = {
    id: uuidv7(),
    cashSessionId,
    terminalId,
    kind: req.kind,
    amountCents,
    supplierId,
    supplier,
    document: req.document?.trim() || null,
    note: req.note?.trim() || null,
    userId: req.actor.userId,
    userName: req.actor.name,
    createdAt: now.toISOString(),
    invoiceStatus: req.kind === 'supplier_payment' ? 'pending' : null,
    invoiceFileName: null,
    invoiceUploadedAt: null
  }
  insertCashMovement(db, movement)
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (?, 'cash_movement', ?, 'create', ?)`
  ).run(uuidv7(), movement.id, JSON.stringify(movement))
  recordAuditEvent(db, {
    type: 'cash.movement',
    terminalId,
    actor: req.actor,
    cashSessionId,
    entityId: movement.id,
    occurredAt: now,
    data: {
      kind: movement.kind,
      amountCents,
      supplier: movement.supplier,
      document: movement.document,
      note: movement.note
    }
  })
  return movement
}

/** Record a movement in the terminal's open caja. */
export function recordCashMovement(
  db: DB,
  terminalId: string,
  req: RecordCashMovementRequest,
  now: Date = new Date()
): CashMovement {
  const txn = db.transaction((): CashMovement => {
    const session = getOpenSessions(db, terminalId)[0]
    if (!session) throw new Error('No hay ninguna caja abierta')
    return insertMovementInTxn(db, terminalId, session.id, req, now)
  })
  return txn.immediate()
}

/** Movements of the terminal's open caja (empty when none is open). */
export function currentCashMovements(db: DB, terminalId: string): CashMovementsSummary {
  const session = getOpenSessions(db, terminalId)[0]
  return summarizeCashMovements(session ? listCashMovements(db, session.id) : [])
}

/**
 * Record that the server now stores this supplier payment's invoice (called once
 * the upload — from the till or from a phone via QR — is confirmed). Idempotent.
 */
export function markInvoiceUploaded(
  db: DB,
  terminalId: string,
  req: MarkInvoiceUploadedRequest,
  now: Date = new Date()
): CashMovement {
  const txn = db.transaction((): CashMovement => {
    const movement = getCashMovement(db, req.cashMovementId)
    if (!movement || movement.terminalId !== terminalId) throw new Error('Pago no encontrado')
    if (movement.kind !== 'supplier_payment')
      throw new Error('Solo los pagos a proveedor llevan factura')
    if (movement.invoiceStatus === 'uploaded') return movement
    db.prepare(
      `UPDATE cash_movements
          SET invoice_status = 'uploaded', invoice_file_name = ?, invoice_uploaded_at = ?
        WHERE id = ?`
    ).run(req.fileName, now.toISOString(), movement.id)
    recordAuditEvent(db, {
      type: 'supplier_invoice.uploaded',
      terminalId,
      actor: req.actor,
      cashSessionId: movement.cashSessionId,
      entityId: movement.id,
      occurredAt: now,
      data: {
        supplier: movement.supplier,
        amountCents: movement.amountCents,
        document: movement.document,
        fileName: req.fileName,
        via: req.via
      }
    })
    return getCashMovement(db, movement.id)!
  })
  return txn.immediate()
}
