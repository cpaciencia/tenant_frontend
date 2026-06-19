export interface BarcodeMatcherOptions {
  /** Minimum characters for a burst to count as a scan. Default 3. */
  minLength?: number
  /** Max ms between keystrokes within one scan. Slower => human typing. Default 50. */
  maxIntervalMs?: number
}

export interface BarcodeMatcher {
  /**
   * Feed one keydown. Returns the scanned code when a burst completes (Enter
   * after a fast-enough sequence of at least `minLength` chars), otherwise null.
   */
  push: (key: string, timeStamp: number) => string | null
  reset: () => void
}

/**
 * Pure state machine for USB barcode scanners operating as a keyboard wedge.
 * Scanners emit characters in a tight burst (<50ms apart) ended by Enter. Human
 * typing is slower, so any gap longer than `maxIntervalMs` resets the buffer —
 * which is also why a focused input doesn't need to be involved.
 */
export function createBarcodeMatcher(options: BarcodeMatcherOptions = {}): BarcodeMatcher {
  const minLength = options.minLength ?? 3
  const maxIntervalMs = options.maxIntervalMs ?? 50

  let buffer = ''
  let lastTime = 0

  return {
    push(key, timeStamp) {
      const gap = timeStamp - lastTime
      lastTime = timeStamp
      // A slow keystroke breaks the burst: start over from this key.
      if (gap > maxIntervalMs) buffer = ''

      if (key === 'Enter') {
        const code = buffer
        buffer = ''
        return code.length >= minLength ? code : null
      }
      // Only printable single characters extend the code; ignore modifiers etc.
      if (key.length === 1) buffer += key
      return null
    },
    reset() {
      buffer = ''
      lastTime = 0
    }
  }
}
