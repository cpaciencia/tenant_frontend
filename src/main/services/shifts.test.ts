import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SHIFTS,
  handoverSlot,
  nextShiftSlot,
  resolveShiftAt,
  sanitizeShifts,
  slotEnd
} from '../../shared/shifts'

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute)
const morning = { shiftId: 'morning', shiftName: 'Mañana', businessDate: '2026-10-01' }
const afternoon = { shiftId: 'afternoon', shiftName: 'Tarde', businessDate: '2026-10-01' }

describe('shifts', () => {
  it('resolves the running shift by local time', () => {
    expect(resolveShiftAt(DEFAULT_SHIFTS, at(1, 8))).toEqual(morning)
    expect(resolveShiftAt(DEFAULT_SHIFTS, at(1, 15, 59))).toEqual(morning)
    expect(resolveShiftAt(DEFAULT_SHIFTS, at(1, 16))).toEqual(afternoon)
    expect(resolveShiftAt(DEFAULT_SHIFTS, at(1, 23, 59))).toEqual(afternoon)
  })

  it('outside every shift, resolves the next upcoming one', () => {
    expect(resolveShiftAt(DEFAULT_SHIFTS, at(2, 3))).toEqual({
      ...morning,
      businessDate: '2026-10-02'
    })
  })

  it('attributes the after-midnight part of an overnight shift to the previous day', () => {
    const night = [
      { id: 'day', name: 'Día', start: '08:00', end: '20:00' },
      { id: 'night', name: 'Noche', start: '20:00', end: '04:00' }
    ]
    expect(resolveShiftAt(night, at(2, 2))).toEqual({
      shiftId: 'night',
      shiftName: 'Noche',
      businessDate: '2026-10-01'
    })
  })

  it('cycles to the first shift of the next day', () => {
    expect(nextShiftSlot(DEFAULT_SHIFTS, morning)).toEqual(afternoon)
    expect(nextShiftSlot(DEFAULT_SHIFTS, afternoon)).toEqual({
      ...morning,
      businessDate: '2026-10-02'
    })
  })

  it('computes the end of a slot, wrapping past midnight', () => {
    expect(slotEnd(DEFAULT_SHIFTS, morning)).toEqual(at(1, 16))
    expect(slotEnd(DEFAULT_SHIFTS, afternoon)).toEqual(at(2, 0))
  })

  it('hands over to the next shift, skipping shifts that already ended', () => {
    expect(handoverSlot(DEFAULT_SHIFTS, morning, at(1, 15))).toEqual(afternoon)
    expect(handoverSlot(DEFAULT_SHIFTS, afternoon, at(1, 23))).toEqual({
      ...morning,
      businessDate: '2026-10-02'
    })
  })

  it('rejects invalid shift lists', () => {
    expect(sanitizeShifts([])).toBeNull()
    expect(sanitizeShifts([{ id: 'a', name: 'A', start: '25:00', end: '10:00' }])).toBeNull()
    expect(sanitizeShifts([{ id: 'a', name: 'A', start: '08:00', end: '08:00' }])).toBeNull()
    expect(
      sanitizeShifts([
        { id: 'a', name: 'A', start: '08:00', end: '16:00' },
        { id: 'a', name: 'B', start: '16:00', end: '00:00' }
      ])
    ).toBeNull()
    expect(sanitizeShifts(DEFAULT_SHIFTS)).toEqual(DEFAULT_SHIFTS)
  })
})
