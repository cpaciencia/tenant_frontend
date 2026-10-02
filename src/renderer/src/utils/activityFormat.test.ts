import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_GROUPS,
  EVENT_TYPES,
  csvCell,
  describeEvent,
  eventAmountCents,
  suspicionOf,
  typeMeta,
  typesOfGroup
} from './activityFormat'
import { RENDERER_AUDIT_TYPES } from '../../../shared/types'

describe('activityFormat', () => {
  it('knows every event type the renderer can report', () => {
    for (const type of RENDERER_AUDIT_TYPES) expect(EVENT_TYPES[type]).toBeDefined()
  })

  it('every type belongs to one of the quick-filter groups', () => {
    const groups = new Set(ACTIVITY_GROUPS.map((g) => g.id))
    for (const meta of Object.values(EVENT_TYPES)) expect(groups.has(meta.group)).toBe(true)
    expect(typesOfGroup('deshechos')).toEqual([
      'ticket.parked_discarded',
      'ticket.line_removed',
      'ticket.qty_decreased',
      'ticket.cleared',
      'payment.cancelled'
    ])
  })

  it('describes a removed line and signs its amount negative', () => {
    const data = { name: 'Pan', quantity: 2, priceCents: 120, manual: false }
    expect(describeEvent('ticket.line_removed', data)).toMatch(/Quitó del ticket 2 × Pan a 1,20/)
    expect(eventAmountCents('ticket.line_removed', data)).toBe(-240)
  })

  it('describes a sale with its tenders and manual lines', () => {
    const text = describeEvent('sale.completed', {
      ticketNumber: 'T01-2026-00033',
      lines: 2,
      units: 3,
      cashCents: 1000,
      cardCents: 249,
      creditCents: 0,
      manualLines: 1,
      totalCents: 1249
    })
    expect(text).toContain('Ticket T01-2026-00033')
    expect(text).toContain('tarjeta 2,49')
    expect(text).toContain('1 a mano')
  })

  it('describes a cierre with its difference in words', () => {
    expect(
      describeEvent('cash_session.closed', {
        shiftName: 'Tarde',
        businessDate: '2026-10-01',
        zNumber: 3,
        salesCount: 10,
        totalCents: 5000,
        differenceCents: -250
      })
    ).toMatch(/faltan 2,50/)
    expect(eventAmountCents('cash_session.closed', { differenceCents: -250 })).toBe(-250)
  })

  it('lists what was in an emptied ticket', () => {
    expect(
      describeEvent('ticket.cleared', {
        reason: 'manual',
        lines: 2,
        items: [
          { name: 'Jabón', quantity: 1 },
          { name: 'Pan', quantity: 3 }
        ]
      })
    ).toMatch(/^Vació un ticket sin cobrar de 2 línea\(s\) \(.*\): 1 × Jabón, 3 × Pan$/)
  })

  it('flags a ticket emptied after typing the cash handed over', () => {
    const data = {
      lines: 1,
      totalCents: 1250,
      items: [{ name: 'Tabaco', quantity: 1 }],
      paymentOpened: true,
      maxTenderedCents: 2000,
      secondsOpen: 45
    }
    expect(describeEvent('ticket.cleared', data)).toContain('tecleado 20,00')
    expect(suspicionOf('ticket.cleared', data)).toMatch(/efectivo entregado/)
    expect(suspicionOf('ticket.cleared', { lines: 1, paymentOpened: false })).toBeNull()
  })

  it('describes how a product was added', () => {
    expect(
      describeEvent('ticket.line_added', {
        source: 'scan',
        name: 'Pan',
        quantity: 2,
        priceCents: 120
      })
    ).toMatch(/^Añadió 2 × Pan a 1,20\s€ \(escaneado\)$/)
  })

  it('falls back gracefully for unknown types', () => {
    expect(typeMeta('weird.type').label).toBe('weird.type')
    expect(describeEvent('weird.type', {})).toBe('—')
    expect(eventAmountCents('auth.login', {})).toBeNull()
  })

  it('escapes CSV cells', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell(null)).toBe('')
  })
})
