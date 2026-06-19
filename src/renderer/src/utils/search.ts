/**
 * Lightweight fuzzy search shared by the POS grid and the backoffice search boxes.
 * Works in memory over the already-loaded list/mirror (small enough), so it needs
 * no backend round-trip and works offline. Tolerates accents and typos:
 * normalises (lowercase + strips diacritics) and ranks exact > prefix > substring
 * > trigram-similar. (The backend has a Postgres pg_trgm path for at-scale search.)
 */

/** Lowercase and strip diacritics so "Agüa" and "agua" compare equal. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `
  const set = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3))
  return set
}

/**
 * Trigram containment: how much of the query appears in the text (query trigrams
 * found in text / query trigrams). Unlike Dice it doesn't punish a long text, so a
 * short query still matches a long product name.
 */
export function similarity(query: string, text: string): number {
  const tq = trigrams(query)
  const tt = trigrams(text)
  if (tq.size === 0) return 0
  let found = 0
  for (const g of tq) if (tt.has(g)) found++
  return found / tq.size
}

const HAS_LETTER = /[a-z]/

/** Score a normalized query against one field; 0 = no match, higher = better. */
function fieldScore(query: string, text: string): number {
  const t = normalizeText(text)
  if (!t) return 0
  if (t === query) return 1000
  if (t.startsWith(query)) return 900 - (t.length - query.length) * 0.1
  if (t.includes(query)) return 700
  // Fuzzy (trigram) only for alphabetic text — avoids false matches between
  // similar-looking numeric codes (barcodes), which are exact/substring only.
  if (!HAS_LETTER.test(t) || !HAS_LETTER.test(query)) return 0
  const sim = similarity(query, t)
  return sim >= 0.4 ? 300 + sim * 100 : 0
}

/**
 * Filter + rank `items` by `query` across the fields returned by `fields`. Empty
 * query returns the list unchanged (preserving its order).
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  fields: (item: T) => Array<string | null | undefined>
): T[] {
  const q = normalizeText(query)
  if (!q) return items
  return items
    .map((item) => {
      const texts = fields(item).filter((x): x is string => !!x)
      const score = texts.reduce((best, f) => Math.max(best, fieldScore(q, f)), 0)
      return { item, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}
