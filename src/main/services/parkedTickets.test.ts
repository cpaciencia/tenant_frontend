import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import {
  discardParkedTicket,
  listParkedTickets,
  parkTicket,
  resumeParkedTicket
} from './parkedTickets'
import type { OpenTicketLine } from '../../shared/types'

let db: DB
const ana = { userId: 'ana', name: 'Ana' }
const lines: OpenTicketLine[] = [
  { key: 'k1', id: 'pan', name: 'Pan', price: 1.2, qty: 2 },
  { key: 'k2', id: 'leche', name: 'Leche', price: 1.1, qty: 1 }
]
const events = (type: string): Record<string, unknown>[] =>
  (
    db.prepare('SELECT data_json FROM audit_events WHERE type = ?').all(type) as {
      data_json: string
    }[]
  ).map((r) => JSON.parse(r.data_json))

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

describe('parked tickets', () => {
  it('parks a ticket with its total and audits its content', () => {
    const parked = parkTicket(db, 'T01', { draftId: 'd1', lines, actor: ana })
    expect(parked).toMatchObject({ draftId: 'd1', parkedByName: 'Ana', totalCents: 350 })
    expect(listParkedTickets(db, 'T01')).toHaveLength(1)
    expect(events('ticket.parked')[0]).toMatchObject({ draftId: 'd1', lines: 2, totalCents: 350 })
  })

  it('resuming returns the lines and removes it from the list', () => {
    const { id } = parkTicket(db, 'T01', { draftId: 'd1', lines, actor: ana })
    const resumed = resumeParkedTicket(db, 'T01', { id, actor: ana })
    expect(resumed.lines).toEqual(lines)
    expect(listParkedTickets(db, 'T01')).toHaveLength(0)
    expect(events('ticket.resumed')[0]).toMatchObject({ draftId: 'd1', parkedByName: 'Ana' })
    expect(() => resumeParkedTicket(db, 'T01', { id, actor: ana })).toThrow(/ya no existe/)
  })

  it('discarding is audited with what was in it', () => {
    const { id } = parkTicket(db, 'T01', { draftId: null, lines, actor: ana })
    discardParkedTicket(db, 'T01', { id, actor: { userId: 'luis', name: 'Luis' } })
    const [event] = events('ticket.parked_discarded')
    expect(event.items).toHaveLength(2)
    expect(event.totalCents).toBe(350)
  })

  it('refuses to park an empty ticket', () => {
    expect(() => parkTicket(db, 'T01', { draftId: null, lines: [], actor: ana })).toThrow()
  })
})
