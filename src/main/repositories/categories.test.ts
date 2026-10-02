import { describe, it, expect, beforeEach } from 'vitest'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import {
  listCategories,
  upsertCategories,
  replaceCategories,
  getCategoriesWatermark,
  countCategories,
  type MirroredCategory
} from './categories'

let db: DB

function cat(over: Partial<MirroredCategory> & { id: string; name: string }): MirroredCategory {
  return {
    parentId: null,
    accountingGroupId: 'g1',
    color: null,
    icon: null,
    active: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
})

describe('categories mirror repository', () => {
  it('upserts by id (updates the existing row instead of duplicating)', () => {
    upsertCategories(db, [cat({ id: 'c1', name: 'Bebidas' })])
    upsertCategories(db, [cat({ id: 'c1', name: 'Bebidas y refrescos' })])
    expect(countCategories(db)).toBe(1)
    expect(listCategories(db)[0].name).toBe('Bebidas y refrescos')
  })

  it('lists only active categories, ordered by name, mapped to camelCase', () => {
    upsertCategories(db, [
      cat({ id: 'c2', name: 'Snacks', active: false }),
      cat({ id: 'c1', name: 'Aguas', parentId: 'p1', accountingGroupId: 'BARRA' })
    ])
    const list = listCategories(db)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'c1',
      name: 'Aguas',
      parentId: 'p1',
      accountingGroupId: 'BARRA',
      active: true
    })
  })

  it('replaceCategories drops orphan rows (old ids) left after a backend reset', () => {
    // Simulate: the mirror holds the pre-reset categories (old ids)...
    upsertCategories(db, [
      cat({ id: 'old-1', name: 'Bebidas' }),
      cat({ id: 'old-2', name: 'Snacks' })
    ])
    // ...then a clean re-pull brings the same categories with NEW ids.
    const fresh = replaceCategories(db, [
      cat({ id: 'new-1', name: 'Bebidas' }),
      cat({ id: 'new-2', name: 'Snacks' })
    ])
    expect(fresh).toBe(2)
    // No duplicates: only the new set survives (a plain upsert would have left 4).
    expect(countCategories(db)).toBe(2)
    expect(
      listCategories(db)
        .map((c) => c.id)
        .sort()
    ).toEqual(['new-1', 'new-2'])
  })

  it('tracks the max updatedAt as the watermark', () => {
    expect(getCategoriesWatermark(db)).toBeNull()
    upsertCategories(db, [
      cat({ id: 'c1', name: 'A', updatedAt: '2026-01-01T00:00:00.000Z' }),
      cat({ id: 'c2', name: 'B', updatedAt: '2026-03-01T00:00:00.000Z' })
    ])
    expect(getCategoriesWatermark(db)).toBe('2026-03-01T00:00:00.000Z')
  })
})
