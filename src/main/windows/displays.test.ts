import { describe, it, expect } from 'vitest'
import { pickExternalDisplay } from './displays'

describe('pickExternalDisplay', () => {
  it('returns null when only the primary display exists', () => {
    expect(pickExternalDisplay([{ id: 1 }], 1)).toBeNull()
  })

  it('returns the first non-primary display', () => {
    const displays = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(pickExternalDisplay(displays, 1)).toEqual({ id: 2 })
  })

  it('handles the primary not being first in the list', () => {
    const displays = [{ id: 5 }, { id: 9 }]
    expect(pickExternalDisplay(displays, 9)).toEqual({ id: 5 })
  })
})
