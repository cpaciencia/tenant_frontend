/**
 * Money typed by people at a till. Spanish formatting uses "," for decimals and
 * "." for thousands, but cashiers type the decimal with whatever key is at hand —
 * very often the numeric keypad's "." — so a strict locale parser turns "142.5"
 * into 1425. These helpers accept either separator as the decimal mark.
 */

/**
 * Parse a typed amount into a number (null when empty or not a number).
 *
 * - Only one kind of separator: "," is always decimal; a single "." is decimal
 *   too ("142.5" → 142.5); several "." are thousands ("1.234.567" → 1234567).
 * - Both kinds: the last one is the decimal mark ("1.234,5" and "1,234.5" → 1234.5).
 */
export function parseMoneyInput(text: string, maxFractionDigits = 2): number | null {
  const trimmed = text.replace(/[\s€]/g, '')
  const sign = trimmed.startsWith('-') ? -1 : 1
  const cleaned = sign < 0 ? trimmed.slice(1) : trimmed
  if (!cleaned) return null
  if (!/^[\d.,]+$/.test(cleaned)) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let decimalIndex = -1
  if (lastComma >= 0 && lastDot >= 0) {
    decimalIndex = Math.max(lastComma, lastDot)
  } else if (lastComma >= 0) {
    decimalIndex = lastComma
  } else if (lastDot >= 0 && cleaned.indexOf('.') === lastDot) {
    decimalIndex = lastDot
  }

  const intPart = (decimalIndex >= 0 ? cleaned.slice(0, decimalIndex) : cleaned).replace(
    /[.,]/g,
    ''
  )
  const fracPart = decimalIndex >= 0 ? cleaned.slice(decimalIndex + 1).replace(/[.,]/g, '') : ''
  // Round half-up on the digits themselves (binary floats would turn 1,005 into 1,00).
  const kept = fracPart.slice(0, maxFractionDigits)
  const roundUp = Number(fracPart.charAt(maxFractionDigits) || '0') >= 5
  const value =
    Number(`${intPart || '0'}.${kept || '0'}`) + (roundUp ? 10 ** -maxFractionDigits : 0)
  if (!Number.isFinite(value)) return null
  return sign * Number(value.toFixed(maxFractionDigits))
}

/** "142,5" style text for editing (no thousands grouping, comma decimal). */
export function toEditableMoney(value: number | null, maxFractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return ''
  return value
    .toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: maxFractionDigits })
    .replace(/\s/g, '')
}

/** "1.234,50 €" for display. */
export function formatMoney(value: number | null, maxFractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return ''
  return value.toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, maxFractionDigits)
  })
}
