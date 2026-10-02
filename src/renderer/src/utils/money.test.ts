import { describe, it, expect } from 'vitest'
import { formatMoney, parseMoneyInput, toEditableMoney } from './money'

describe('parseMoneyInput', () => {
  it('accepts the comma as decimal mark', () => {
    expect(parseMoneyInput('142,5')).toBe(142.5)
    expect(parseMoneyInput('0,99')).toBe(0.99)
  })

  it('accepts a single dot as decimal mark (numeric keypad)', () => {
    expect(parseMoneyInput('142.5')).toBe(142.5)
    expect(parseMoneyInput('1.20')).toBe(1.2)
  })

  it('treats several dots as thousands separators', () => {
    expect(parseMoneyInput('1.234.567')).toBe(1234567)
  })

  it('uses the last separator as decimal when both appear', () => {
    expect(parseMoneyInput('1.234,5')).toBe(1234.5)
    expect(parseMoneyInput('1,234.5')).toBe(1234.5)
  })

  it('ignores spaces and the euro sign', () => {
    expect(parseMoneyInput(' 150,00 € ')).toBe(150)
  })

  it('rounds to the allowed fraction digits', () => {
    expect(parseMoneyInput('1,005')).toBe(1.01)
    expect(parseMoneyInput('0,1234', 4)).toBe(0.1234)
  })

  it('returns null for empty or non-numeric text', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
    expect(parseMoneyInput('12a')).toBeNull()
  })

  it('keeps the sign of negative amounts (deposit refunds), rounding away from zero', () => {
    expect(parseMoneyInput('-2,5')).toBe(-2.5)
    expect(parseMoneyInput('-1,005')).toBe(-1.01)
    expect(parseMoneyInput('-')).toBeNull()
  })

  it('handles a trailing separator while typing', () => {
    expect(parseMoneyInput('142,')).toBe(142)
    expect(parseMoneyInput('142.')).toBe(142)
  })
})

describe('money formatting', () => {
  it('formats for editing without grouping', () => {
    expect(toEditableMoney(1234.5)).toBe('1234,5')
    expect(toEditableMoney(null)).toBe('')
  })

  it('formats for display as euros', () => {
    expect(formatMoney(1234.5)).toMatch(/1\.?234,50\s€/)
  })
})
