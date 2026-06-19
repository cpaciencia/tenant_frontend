import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { createSale } from './sales'
import { previewZReport, closeZReport, listZClosures } from './zReport'
import { upsertAccountingGroups } from '../repositories/accountingGroups'

let db: DB

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  upsertAccountingGroups(db, [
    { id: 'g1', code: 'BARRA', name: 'Barra', active: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    {
      id: 'g2',
      code: 'BODEGA',
      name: 'Bodega',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ])
})

function cash(total: number): {
  cashCents: number
  cardCents: number
  creditCents: number
  clientId: null
} {
  return { cashCents: total, cardCents: 0, creditCents: 0, clientId: null }
}

function seedSales(): void {
  createSale(db, 'T01', {
    items: [{ productId: 'p1', quantity: 2, unitPriceCents: 150, accountingGroupId: 'g1' }],
    payment: cash(300)
  })
  createSale(db, 'T01', {
    items: [
      { productId: 'p2', quantity: 1, unitPriceCents: 500, accountingGroupId: 'g2' },
      { productId: 'p3', quantity: 1, unitPriceCents: 100, accountingGroupId: 'g1' }
    ],
    payment: cash(600)
  })
}

describe('zReport', () => {
  it('previews the pending takings broken down by caja', () => {
    seedSales()
    const report = previewZReport(db)
    expect(report.salesCount).toBe(2)
    expect(report.totalCents).toBe(900)
    // Sorted by code: BARRA (300+100), BODEGA (500)
    expect(report.breakdown).toEqual([
      { accountingGroupId: 'g1', code: 'BARRA', name: 'Barra', totalCents: 400 },
      { accountingGroupId: 'g2', code: 'BODEGA', name: 'Bodega', totalCents: 500 }
    ])
  })

  it('buckets lines with no caja under "SIN CAJA"', () => {
    createSale(db, 'T01', {
      items: [{ productId: 'p9', quantity: 1, unitPriceCents: 250, accountingGroupId: null }],
      payment: cash(250)
    })
    const report = previewZReport(db)
    expect(report.breakdown).toHaveLength(1)
    expect(report.breakdown[0]).toMatchObject({
      accountingGroupId: null,
      code: 'SIN CAJA',
      totalCents: 250
    })
  })

  it('seals pending sales: next preview is empty and history grows', () => {
    seedSales()
    const closure = closeZReport(db, 'T01')
    expect(closure.zNumber).toBe(1)
    expect(closure.totalCents).toBe(900)
    expect(closure.salesCount).toBe(2)

    // Sealed: nothing left to close.
    expect(previewZReport(db).salesCount).toBe(0)
    const history = listZClosures(db)
    expect(history).toHaveLength(1)
    expect(history[0].zNumber).toBe(1)
  })

  it('only closes sales made after the previous closure', () => {
    seedSales()
    closeZReport(db, 'T01') // Z1: 900
    createSale(db, 'T01', {
      items: [{ productId: 'p4', quantity: 1, unitPriceCents: 1000, accountingGroupId: 'g2' }],
      payment: cash(1000)
    })
    const z2 = closeZReport(db, 'T01')
    expect(z2.zNumber).toBe(2)
    expect(z2.totalCents).toBe(1000)
  })

  it('throws when there is nothing to close', () => {
    expect(() => closeZReport(db, 'T01')).toThrow(/pendientes/)
  })
})
