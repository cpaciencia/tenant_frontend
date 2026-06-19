import { describe, it, expect } from 'vitest'
import { normalizeText, similarity, fuzzySearch } from './search'

interface P {
  name: string
  barcode?: string | null
}

const items: P[] = [
  { name: 'Agua Mineral 1,5L', barcode: '8412345000017' },
  { name: 'Coca Cola Lata', barcode: '8412345000024' },
  { name: 'Vino Tinto Crianza', barcode: null }
]

function names(list: P[]): string[] {
  return list.map((p) => p.name)
}

describe('search util', () => {
  it('normalizes case and accents', () => {
    expect(normalizeText('Agüita')).toBe('aguita')
    expect(normalizeText('  VINO  ')).toBe('vino')
  })

  it('similarity is high for near-identical strings, low for unrelated', () => {
    expect(similarity('agua', 'agau')).toBeGreaterThan(0.3)
    expect(similarity('agua', 'zzzzz')).toBeLessThan(0.1)
  })

  it('finds substring matches case/accent-insensitively', () => {
    expect(names(fuzzySearch(items, 'cola', (p) => [p.name]))).toEqual(['Coca Cola Lata'])
  })

  it('tolerates typos (fuzzy)', () => {
    expect(names(fuzzySearch(items, 'agau', (p) => [p.name, p.barcode]))).toContain('Agua Mineral 1,5L')
    expect(names(fuzzySearch(items, 'vino tnto', (p) => [p.name]))).toContain('Vino Tinto Crianza')
  })

  it('matches by barcode field', () => {
    expect(names(fuzzySearch(items, '8412345000024', (p) => [p.name, p.barcode]))).toEqual([
      'Coca Cola Lata'
    ])
  })

  it('empty query returns the list unchanged', () => {
    expect(fuzzySearch(items, '   ', (p) => [p.name])).toHaveLength(3)
  })
})
