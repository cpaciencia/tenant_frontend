import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type { ZReport, ZClosure, ZBreakdownRow } from '../../shared/types'
import { listAccountingGroups } from '../repositories/accountingGroups'

/**
 * Cash-up (Z) report. Aggregates every sale not yet assigned to a closure and
 * breaks the takings down by accounting group (caja), resolving each line's
 * snapshotted `accountingGroupId` to a code/name from the local cajas mirror.
 *
 * Closing is atomic: it seals the pending sales by stamping them with the new
 * `z_closure_id`, so "since the last close" needs no timestamp arithmetic and a
 * sale can never land in two closures.
 */

const NO_CAJA_KEY = '__none__'

interface SaleRow {
  id: string
  total_cents: number
  items_json: string
}

interface SaleItem {
  productId: string
  quantity: number
  unitPriceCents: number
  accountingGroupId: string | null
}

function pendingSales(db: DB): SaleRow[] {
  return db
    .prepare(
      `SELECT id, total_cents, items_json
         FROM sales
        WHERE z_closure_id IS NULL AND status = 'completed'
        ORDER BY created_at`
    )
    .all() as SaleRow[]
}

/** Aggregate sale rows into a Z report (total + per-caja breakdown). */
function aggregate(db: DB, rows: SaleRow[]): ZReport {
  const cajas = new Map(listAccountingGroups(db).map((g) => [g.id, g]))
  const buckets = new Map<string, ZBreakdownRow>()
  let totalCents = 0

  for (const row of rows) {
    totalCents += row.total_cents
    let items: SaleItem[] = []
    try {
      items = JSON.parse(row.items_json) as SaleItem[]
    } catch {
      items = []
    }
    for (const item of items) {
      const lineTotal = item.quantity * item.unitPriceCents
      const key = item.accountingGroupId ?? NO_CAJA_KEY
      const existing = buckets.get(key)
      if (existing) {
        existing.totalCents += lineTotal
        continue
      }
      const caja = item.accountingGroupId ? cajas.get(item.accountingGroupId) : undefined
      buckets.set(key, {
        accountingGroupId: item.accountingGroupId,
        code: caja?.code ?? (item.accountingGroupId ? '??' : 'SIN CAJA'),
        name: caja?.name ?? (item.accountingGroupId ? 'Caja desconocida' : 'Sin caja asignada'),
        totalCents: lineTotal
      })
    }
  }

  const breakdown = [...buckets.values()].sort((a, b) => a.code.localeCompare(b.code))
  return { salesCount: rows.length, totalCents, breakdown }
}

/** Live preview of the next cash-up — does NOT seal anything. */
export function previewZReport(db: DB): ZReport {
  return aggregate(db, pendingSales(db))
}

/** History of past closures, newest first. */
export function listZClosures(db: DB): ZClosure[] {
  const rows = db
    .prepare(
      `SELECT id, terminal_id, z_number, closed_at, total_cents, sales_count, breakdown_json
         FROM z_closures ORDER BY z_number DESC`
    )
    .all() as Array<{
    id: string
    terminal_id: string
    z_number: number
    closed_at: string
    total_cents: number
    sales_count: number
    breakdown_json: string
  }>
  return rows.map((r) => ({
    id: r.id,
    terminalId: r.terminal_id,
    zNumber: r.z_number,
    closedAt: r.closed_at,
    totalCents: r.total_cents,
    salesCount: r.sales_count,
    breakdown: safeBreakdown(r.breakdown_json)
  }))
}

function safeBreakdown(json: string): ZBreakdownRow[] {
  try {
    return JSON.parse(json) as ZBreakdownRow[]
  } catch {
    return []
  }
}

/**
 * Seal a cash-up: aggregate the pending sales, persist the Z closure, stamp those
 * sales with its id, and enqueue a sync row — all in one transaction. Throws when
 * there is nothing to close.
 */
export function closeZReport(db: DB, terminalId: string): ZClosure {
  const insertClosureStmt = db.prepare(
    `INSERT INTO z_closures
       (id, terminal_id, z_number, closed_at, total_cents, sales_count, breakdown_json)
     VALUES (@id, @terminalId, @zNumber, @closedAt, @totalCents, @salesCount, @breakdownJson)`
  )
  const nextZStmt = db.prepare<[string], { next: number }>(
    `SELECT COALESCE(MAX(z_number), 0) + 1 AS next FROM z_closures WHERE terminal_id = ?`
  )
  const stampStmt = db.prepare(
    `UPDATE sales SET z_closure_id = ? WHERE z_closure_id IS NULL AND status = 'completed'`
  )
  const insertSyncStmt = db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload)
     VALUES (@id, 'z_closure', @entityId, 'create', @payload)`
  )

  const txn = db.transaction((): ZClosure => {
    const rows = pendingSales(db)
    if (rows.length === 0) {
      throw new Error('No hay ventas pendientes de cierre')
    }
    const report = aggregate(db, rows)
    const id = uuidv7()
    const zNumber = nextZStmt.get(terminalId)!.next
    const closedAt = new Date().toISOString()

    insertClosureStmt.run({
      id,
      terminalId,
      zNumber,
      closedAt,
      totalCents: report.totalCents,
      salesCount: report.salesCount,
      breakdownJson: JSON.stringify(report.breakdown)
    })
    stampStmt.run(id)

    const closure: ZClosure = {
      id,
      terminalId,
      zNumber,
      closedAt,
      totalCents: report.totalCents,
      salesCount: report.salesCount,
      breakdown: report.breakdown
    }
    // Sync payload also carries the sealed sale ids so the backend can link the
    // tickets to this closure (the renderer's ZClosure result doesn't need them).
    insertSyncStmt.run({
      id: uuidv7(),
      entityId: id,
      payload: JSON.stringify({ ...closure, saleIds: rows.map((r) => r.id) })
    })
    return closure
  })

  return txn.immediate()
}
