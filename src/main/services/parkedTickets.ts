import { v7 as uuidv7 } from 'uuid'
import type { DB } from '../db/connection'
import type {
  OpenTicketLine,
  ParkTicketRequest,
  ParkedTicket,
  ParkedTicketActionRequest
} from '../../shared/types'
import { recordAuditEvent } from '../repositories/auditEvents'

interface ParkedRow {
  id: string
  draft_id: string | null
  parked_at: string
  parked_by_user_id: string | null
  parked_by_name: string
  lines_json: string
  total_cents: number
}

function mapRow(r: ParkedRow): ParkedTicket {
  let lines: OpenTicketLine[] = []
  try {
    lines = JSON.parse(r.lines_json) as OpenTicketLine[]
  } catch {
    lines = []
  }
  return {
    id: r.id,
    draftId: r.draft_id,
    parkedAt: r.parked_at,
    parkedByUserId: r.parked_by_user_id,
    parkedByName: r.parked_by_name,
    lines,
    totalCents: r.total_cents
  }
}

function linesTotalCents(lines: OpenTicketLine[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.price * 100) * l.qty, 0)
}

/** What the audit log keeps about a ticket's content. */
function itemsData(lines: OpenTicketLine[]): Record<string, unknown>[] {
  return lines.map((l) => ({
    productId: l.manual ? null : l.id,
    name: l.name,
    quantity: l.qty,
    priceCents: Math.round(l.price * 100),
    manual: Boolean(l.manual)
  }))
}

function get(db: DB, id: string): ParkedTicket | null {
  const row = db.prepare('SELECT * FROM parked_tickets WHERE id = ?').get(id) as
    | ParkedRow
    | undefined
  return row ? mapRow(row) : null
}

/** Tickets parked on this terminal, oldest first. */
export function listParkedTickets(db: DB, terminalId: string): ParkedTicket[] {
  const rows = db
    .prepare('SELECT * FROM parked_tickets WHERE terminal_id = ? ORDER BY parked_at')
    .all(terminalId) as ParkedRow[]
  return rows.map(mapRow)
}

/** Set an unpaid ticket aside (audited with its full content). */
export function parkTicket(
  db: DB,
  terminalId: string,
  req: ParkTicketRequest,
  now: Date = new Date()
): ParkedTicket {
  if (req.lines.length === 0) throw new Error('No hay nada que aparcar')
  const txn = db.transaction((): ParkedTicket => {
    const id = uuidv7()
    const totalCents = linesTotalCents(req.lines)
    db.prepare(
      `INSERT INTO parked_tickets
         (id, terminal_id, draft_id, parked_at, parked_by_user_id, parked_by_name, lines_json, total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      terminalId,
      req.draftId,
      now.toISOString(),
      req.actor.userId,
      req.actor.name,
      JSON.stringify(req.lines),
      totalCents
    )
    recordAuditEvent(db, {
      type: 'ticket.parked',
      terminalId,
      actor: req.actor,
      entityId: id,
      occurredAt: now,
      data: {
        draftId: req.draftId,
        lines: req.lines.length,
        totalCents,
        items: itemsData(req.lines)
      }
    })
    return get(db, id)!
  })
  return txn.immediate()
}

function take(
  db: DB,
  terminalId: string,
  req: ParkedTicketActionRequest,
  type: 'ticket.resumed' | 'ticket.parked_discarded',
  now: Date
): ParkedTicket {
  const txn = db.transaction((): ParkedTicket => {
    const ticket = get(db, req.id)
    if (!ticket) throw new Error('Ese ticket aparcado ya no existe')
    db.prepare('DELETE FROM parked_tickets WHERE id = ?').run(req.id)
    recordAuditEvent(db, {
      type,
      terminalId,
      actor: req.actor,
      entityId: ticket.id,
      occurredAt: now,
      data: {
        draftId: ticket.draftId,
        lines: ticket.lines.length,
        totalCents: ticket.totalCents,
        parkedByName: ticket.parkedByName,
        parkedAt: ticket.parkedAt,
        minutesParked: Math.round((now.getTime() - new Date(ticket.parkedAt).getTime()) / 60000),
        items: itemsData(ticket.lines)
      }
    })
    return ticket
  })
  return txn.immediate()
}

/** Take a parked ticket back to keep selling it. */
export function resumeParkedTicket(
  db: DB,
  terminalId: string,
  req: ParkedTicketActionRequest,
  now: Date = new Date()
): ParkedTicket {
  return take(db, terminalId, req, 'ticket.resumed', now)
}

/** Throw a parked ticket away unpaid (audited with its content, like emptying a ticket). */
export function discardParkedTicket(
  db: DB,
  terminalId: string,
  req: ParkedTicketActionRequest,
  now: Date = new Date()
): ParkedTicket {
  return take(db, terminalId, req, 'ticket.parked_discarded', now)
}
