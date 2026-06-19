import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Category, Product } from '../../../shared/types'
import { fuzzySearch } from '../utils/search'

/**
 * The sellable catalog for the POS, read from the local SQLite mirror over IPC
 * (`window.api.categories/products`). Works offline: the mirror is refreshed from
 * the backend on launch, but the till reads whatever is stored locally. Replaces
 * the old in-memory sample data (`data/catalog.ts`) for the sale grid.
 *
 * The category tree is two levels deep: the grid shows top-level categories as
 * chips, and a chip lists the products of that category AND its subcategories.
 */
export const useCatalogStore = defineStore('catalog', () => {
  const categories = ref<Category[]>([])
  const products = ref<Product[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [cats, prods] = await Promise.all([
        window.api.categories.list(),
        window.api.products.list()
      ])
      categories.value = cats
      products.value = prods.filter((p) => p.active)
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** Top-level categories (the chips), ordered as the mirror returns them (by name). */
  const rootCategories = computed(() => categories.value.filter((c) => !c.parentId))

  function childIds(categoryId: string): string[] {
    return categories.value.filter((c) => c.parentId === categoryId).map((c) => c.id)
  }

  /** Products of a category plus those of its subcategories. */
  function productsFor(categoryId: string): Product[] {
    const ids = new Set([categoryId, ...childIds(categoryId)])
    return products.value.filter((p) => p.categoryId && ids.has(p.categoryId))
  }

  /** Exact barcode lookup (for the scanner: add immediately, no filtering). */
  function findByBarcode(code: string): Product | null {
    const c = code.trim()
    if (!c) return null
    return products.value.find((p) => p.barcode === c) ?? null
  }

  /** Fuzzy search across all products (name or barcode), tolerant to typos/accents. */
  function searchProducts(query: string): Product[] {
    if (!query.trim()) return []
    return fuzzySearch(products.value, query, (p) => [p.name, p.barcode])
  }

  /** Accent colour for a category id (falls back to the brand green). */
  function colorOf(categoryId: string | null): string {
    const c = categoryId ? categories.value.find((x) => x.id === categoryId) : null
    return c?.color ?? '#27ae60'
  }

  /**
   * Resolve the accounting group (caja) a product rolls up into, via its category.
   * Snapshotted onto the sale line at checkout so the Z-report stays stable.
   */
  function accountingGroupIdFor(productId: string): string | null {
    const product = products.value.find((p) => p.id === productId)
    if (!product?.categoryId) return null
    const category = categories.value.find((c) => c.id === product.categoryId)
    return category?.accountingGroupId ?? null
  }

  return {
    categories,
    products,
    loading,
    loaded,
    load,
    rootCategories,
    productsFor,
    searchProducts,
    findByBarcode,
    colorOf,
    accountingGroupIdFor
  }
})
