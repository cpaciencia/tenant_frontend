/**
 * Shift (turno) calendar logic. A caja belongs to a SHIFT — a configured time
 * slot such as "Mañana 08:00–16:00" — on a given business date, not to a
 * cashier. Pure functions over local wall-clock time: no Node/Electron imports,
 * so both the Main process and the renderer can use them.
 */

/** A configured shift. Times are local "HH:MM"; an end <= start wraps past midnight. */
export interface ShiftDefinition {
  id: string
  name: string
  start: string
  end: string
}

/** A concrete shift occurrence: which shift, on which business date (local YYYY-MM-DD). */
export interface ShiftSlot {
  shiftId: string
  shiftName: string
  businessDate: string
}

export const DEFAULT_SHIFTS: ShiftDefinition[] = [
  { id: 'morning', name: 'Mañana', start: '08:00', end: '16:00' },
  { id: 'afternoon', name: 'Tarde', start: '16:00', end: '00:00' }
]

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value)
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Local calendar date of `d` as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a YYYY-MM-DD date by whole days (local calendar). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

/** Shifts in day order (by start time). */
export function sortShifts(shifts: ShiftDefinition[]): ShiftDefinition[] {
  return [...shifts].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}

function toSlot(shift: ShiftDefinition, businessDate: string): ShiftSlot {
  return { shiftId: shift.id, shiftName: shift.name, businessDate }
}

/**
 * The shift running at `now`. Outside every window (e.g. 03:00 with the shop
 * closed) it returns the next upcoming shift, so a caja opened then is filed
 * under the shift it is about to serve. Null only when no shift is configured.
 */
export function resolveShiftAt(shifts: ShiftDefinition[], now: Date): ShiftSlot | null {
  const sorted = sortShifts(shifts)
  if (sorted.length === 0) return null
  const minutes = now.getHours() * 60 + now.getMinutes()
  const today = localDate(now)

  for (const shift of sorted) {
    const start = toMinutes(shift.start)
    const end = toMinutes(shift.end)
    if (end > start) {
      if (minutes >= start && minutes < end) return toSlot(shift, today)
    } else {
      // Wraps past midnight: the early-morning part belongs to yesterday's shift.
      if (minutes >= start) return toSlot(shift, today)
      if (minutes < end) return toSlot(shift, addDays(today, -1))
    }
  }

  const upcoming = sorted.find((s) => toMinutes(s.start) > minutes)
  return upcoming ? toSlot(upcoming, today) : toSlot(sorted[0], addDays(today, 1))
}

/** The shift that follows `slot` (wrapping to the first shift of the next day). */
export function nextShiftSlot(shifts: ShiftDefinition[], slot: ShiftSlot): ShiftSlot | null {
  const sorted = sortShifts(shifts)
  const index = sorted.findIndex((s) => s.id === slot.shiftId)
  if (index < 0) return null
  return index === sorted.length - 1
    ? toSlot(sorted[0], addDays(slot.businessDate, 1))
    : toSlot(sorted[index + 1], slot.businessDate)
}

/** Local instant at which `slot` ends (null if its shift is no longer configured). */
export function slotEnd(shifts: ShiftDefinition[], slot: ShiftSlot): Date | null {
  const shift = shifts.find((s) => s.id === slot.shiftId)
  if (!shift) return null
  const [y, m, d] = slot.businessDate.split('-').map(Number)
  const start = toMinutes(shift.start)
  const end = toMinutes(shift.end)
  const endDay = end > start ? d : d + 1
  return new Date(y, m - 1, endDay, Math.floor(end / 60), end % 60)
}

/**
 * The slot the caja left open after closing `closing` should belong to: the shift
 * after it, skipping any that already ended (e.g. a caja closed past midnight
 * hands over to the next morning, not to the evening that just finished).
 */
export function handoverSlot(
  shifts: ShiftDefinition[],
  closing: ShiftSlot,
  now: Date
): ShiftSlot | null {
  let candidate = nextShiftSlot(shifts, closing)
  for (let guard = 0; candidate && guard < shifts.length * 3; guard++) {
    const end = slotEnd(shifts, candidate)
    if (!end || end.getTime() > now.getTime()) return candidate
    candidate = nextShiftSlot(shifts, candidate)
  }
  return candidate
}

/** Validate/normalise a shift list from untrusted input. Null if unusable. */
export function sanitizeShifts(value: unknown): ShiftDefinition[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) return null
  const seen = new Set<string>()
  const clean: ShiftDefinition[] = []
  for (const raw of value) {
    const s = raw as Partial<ShiftDefinition>
    const id = typeof s?.id === 'string' ? s.id.trim() : ''
    const name = typeof s?.name === 'string' ? s.name.trim() : ''
    if (!id || !name || seen.has(id) || !isValidTime(s.start) || !isValidTime(s.end)) return null
    if (s.start === s.end) return null
    seen.add(id)
    clean.push({ id, name: name.slice(0, 40), start: s.start, end: s.end })
  }
  return clean
}
