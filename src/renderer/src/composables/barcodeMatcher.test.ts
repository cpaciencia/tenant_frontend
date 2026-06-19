import { describe, it, expect } from 'vitest'
import { createBarcodeMatcher } from './barcodeMatcher'

/** Feeds a sequence of [key, time] pairs, returning the last push() result. */
function feed(
  matcher: ReturnType<typeof createBarcodeMatcher>,
  keys: [string, number][]
): string | null {
  let result: string | null = null
  for (const [key, time] of keys) result = matcher.push(key, time)
  return result
}

describe('createBarcodeMatcher', () => {
  it('returns the code for a fast burst ended by Enter', () => {
    const m = createBarcodeMatcher()
    const result = feed(m, [
      ['8', 1000],
      ['4', 1010],
      ['1', 1020],
      ['2', 1030],
      ['Enter', 1040]
    ])
    expect(result).toBe('8412')
  })

  it('ignores slow (human) typing: gaps reset the buffer', () => {
    const m = createBarcodeMatcher()
    const result = feed(m, [
      ['a', 1000],
      ['b', 1300], // 300ms gap -> resets
      ['c', 1600],
      ['Enter', 1900]
    ])
    expect(result).toBeNull()
  })

  it('rejects bursts shorter than minLength', () => {
    const m = createBarcodeMatcher({ minLength: 4 })
    expect(
      feed(m, [
        ['1', 1000],
        ['2', 1010],
        ['Enter', 1020]
      ])
    ).toBeNull()
  })

  it('ignores modifier keys but keeps the surrounding burst', () => {
    const m = createBarcodeMatcher()
    const result = feed(m, [
      ['Shift', 1000],
      ['A', 1010],
      ['B', 1020],
      ['C', 1030],
      ['Enter', 1040]
    ])
    expect(result).toBe('ABC')
  })

  it('starts a fresh code after a completed scan', () => {
    const m = createBarcodeMatcher()
    feed(m, [
      ['1', 1000],
      ['2', 1010],
      ['3', 1020],
      ['Enter', 1030]
    ])
    const second = feed(m, [
      ['9', 5000],
      ['8', 5010],
      ['7', 5020],
      ['Enter', 5030]
    ])
    expect(second).toBe('987')
  })
})
