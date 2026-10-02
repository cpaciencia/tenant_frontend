import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { closeCashSession, openCashSession, previewSessionArqueo } from './cashSession'
import { currentCashMovements, markInvoiceUploaded, recordCashMovement } from './cashMovements'
import { listSuppliers, upsertSuppliers } from '../repositories/suppliers'
import { createSale } from './sales'
import { DEFAULT_SHIFTS } from '../../shared/shifts'

let db: DB
let sid: string
const ana = { userId: 'ana', name: 'Ana' }

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  sid = openCashSession(
    db,
    'T01',
    { cashierUserId: 'ana', cashierName: 'Ana', openingFloatCents: 15000 },
    DEFAULT_SHIFTS
  ).id
  createSale(db, 'T01', {
    items: [
      { productId: 'p', name: 'P', quantity: 1, unitPriceCents: 1000, accountingGroupId: null }
    ],
    payment: { cashCents: 1000, cardCents: 0, creditCents: 0, clientId: null, clientName: null },
    cashSessionId: sid,
    sellerUserId: 'ana',
    sellerName: 'Ana'
  })
})

describe('cash movements', () => {
  it('puts money in, pays a supplier and reflects both in the expected cash', () => {
    recordCashMovement(db, 'T01', { kind: 'cash_in', amountCents: 20000, actor: ana })
    recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 15000,
      supplier: 'Coca-Cola',
      document: 'ALB-123',
      actor: ana
    })
    const arqueo = previewSessionArqueo(db, sid)
    // 150 float + 10 sales + 200 put in − 150 supplier
    expect(arqueo.expectedCashCents).toBe(21000)
    expect(arqueo.movements).toMatchObject({
      cashInCents: 20000,
      supplierPaymentsCents: 15000,
      cashInPendingCents: 20000
    })
    // Not a sale: sales figures are unchanged.
    expect(arqueo.totalCents).toBe(1000)
  })

  it('requires a supplier name for a supplier payment and a positive amount', () => {
    expect(() =>
      recordCashMovement(db, 'T01', { kind: 'supplier_payment', amountCents: 100, actor: ana })
    ).toThrow(/proveedor/)
    expect(() =>
      recordCashMovement(db, 'T01', { kind: 'cash_in', amountCents: 0, actor: ana })
    ).toThrow(/mayor que 0/)
  })

  it('takes out the money put in at close, sealing every movement in the cierre', () => {
    recordCashMovement(db, 'T01', { kind: 'cash_in', amountCents: 20000, actor: ana })
    const pay = recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 15000,
      supplier: 'Coca-Cola',
      actor: ana
    })
    markInvoiceUploaded(db, 'T01', {
      cashMovementId: pay.id,
      fileName: 'fra.pdf',
      via: 'file',
      actor: ana
    })
    const { closed } = closeCashSession(
      db,
      'T01',
      {
        sessionId: sid,
        countedCashCents: 1000,
        closingFloatCents: 0,
        closedByUserId: 'ana',
        closedByName: 'Ana',
        cashOutCents: 20000
      },
      DEFAULT_SHIFTS
    )
    // 150 + 10 + 200 − 150 − 200 returned = 10
    expect(closed.expectedCashCents).toBe(1000)
    expect(closed.differenceCents).toBe(0)
    expect(closed.cashMovements.map((m) => m.kind)).toEqual([
      'cash_in',
      'supplier_payment',
      'cash_out'
    ])
    const events = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE type = 'cash.movement'`)
      .get() as { n: number }
    expect(events.n).toBe(3)
  })

  it('reports the open caja movements', () => {
    recordCashMovement(db, 'T01', { kind: 'cash_in', amountCents: 5000, actor: ana })
    recordCashMovement(db, 'T01', { kind: 'cash_out', amountCents: 2000, actor: ana })
    expect(currentCashMovements(db, 'T01').cashInPendingCents).toBe(3000)
  })

  it('a supplier payment waits for its invoice and blocks the cierre until it is uploaded', () => {
    const pay = recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 5000,
      supplier: 'Panadería López',
      actor: ana
    })
    expect(pay.invoiceStatus).toBe('pending')
    expect(currentCashMovements(db, 'T01').invoicesPending).toBe(1)
    expect(() =>
      closeCashSession(
        db,
        'T01',
        {
          sessionId: sid,
          countedCashCents: 11000,
          closingFloatCents: 15000,
          closedByUserId: 'ana',
          closedByName: 'Ana'
        },
        DEFAULT_SHIFTS
      )
    ).toThrow(/factura/)

    markInvoiceUploaded(db, 'T01', {
      cashMovementId: pay.id,
      fileName: 'fra.pdf',
      via: 'qr',
      actor: ana
    })
    const after = currentCashMovements(db, 'T01')
    expect(after.invoicesPending).toBe(0)
    expect(after.list[0]).toMatchObject({ invoiceStatus: 'uploaded', invoiceFileName: 'fra.pdf' })
    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_events WHERE type = 'supplier_invoice.uploaded'")
      .get() as { n: number }
    expect(audit.n).toBe(1)
    // Money movements other than supplier payments need no invoice.
    expect(
      recordCashMovement(db, 'T01', { kind: 'cash_in', amountCents: 100, actor: ana }).invoiceStatus
    ).toBeNull()
  })

  it('adds a new supplier once (any case) and queues it for sync', () => {
    const a = recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 100,
      supplier: 'Coca-Cola',
      actor: ana
    })
    const b = recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 100,
      supplier: '  coca-cola ',
      actor: ana
    })
    expect(b.supplierId).toBe(a.supplierId)
    expect(b.supplier).toBe('Coca-Cola')
    expect(listSuppliers(db)).toHaveLength(1)
    const queued = db
      .prepare("SELECT COUNT(*) AS n FROM sync_queue WHERE entity_type = 'supplier'")
      .get() as { n: number }
    expect(queued.n).toBe(1)
  })

  it("the backend's supplier replaces a same-name one added offline and keeps the payments linked", () => {
    const pay = recordCashMovement(db, 'T01', {
      kind: 'supplier_payment',
      amountCents: 100,
      supplier: 'Makro',
      actor: ana
    })
    upsertSuppliers(db, [
      { id: 'server-makro', name: 'MAKRO', active: true, updatedAt: '2026-10-02T00:00:00Z' }
    ])
    expect(listSuppliers(db)).toEqual([{ id: 'server-makro', name: 'MAKRO' }])
    expect(currentCashMovements(db, 'T01').list.find((m) => m.id === pay.id)?.supplierId).toBe(
      'server-makro'
    )
  })

  it('a payment without invoice needs who and what for, needs no invoice and lowers the cash', () => {
    expect(() =>
      recordCashMovement(db, 'T01', {
        kind: 'other_payment',
        amountCents: 3000,
        supplier: 'Juan (jardinero)',
        actor: ana
      })
    ).toThrow(/concepto/)
    const pay = recordCashMovement(db, 'T01', {
      kind: 'other_payment',
      amountCents: 3000,
      supplier: 'Juan (jardinero)',
      note: 'Poda setos',
      actor: ana
    })
    expect(pay.invoiceStatus).toBeNull()
    expect(pay.supplierId).toBeNull()
    expect(listSuppliers(db)).toHaveLength(0)
    const arqueo = previewSessionArqueo(db, sid)
    expect(arqueo.movements.otherPaymentsCents).toBe(3000)
    expect(arqueo.expectedCashCents).toBe(15000 + 1000 - 3000)
  })
})
