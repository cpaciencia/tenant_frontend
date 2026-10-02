import { describe, it, expect } from 'vitest'
import { resolvePeriod } from './period'

const now = new Date(2026, 9, 15, 12)

describe('resolvePeriod', () => {
  it('resolves the presets as inclusive local days', () => {
    expect(resolvePeriod('today', null, now)).toEqual({ from: '2026-10-15', to: '2026-10-15' })
    expect(resolvePeriod('yesterday', null, now)).toEqual({ from: '2026-10-14', to: '2026-10-14' })
    expect(resolvePeriod('7d', null, now)).toEqual({ from: '2026-10-09', to: '2026-10-15' })
    expect(resolvePeriod('month', null, now)).toEqual({ from: '2026-10-01', to: '2026-10-15' })
  })

  it('uses the picked range for custom (a single day when only one is picked)', () => {
    expect(resolvePeriod('custom', [new Date(2026, 8, 1), new Date(2026, 8, 3)], now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-03'
    })
    expect(resolvePeriod('custom', [new Date(2026, 8, 1), null], now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-01'
    })
  })
})
