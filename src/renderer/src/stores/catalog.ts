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
 * chips; a chip with subcategories opens a second bar to narrow down to one of
 * them ("Todo" lists the category AND all its subcategories). Products are shown
 * best sellers first (units sold on this terminal, refreshed after every sale),
 * then alphabetically.
 */

/** Pseudo-subcategory: products filed directly on the parent, in no subcategory. */
export const DIRECT_PRODUCTS = '__direct__'
export const useCatalogStore = defineStore('catalog', () => {
  const categories = ref<Category[]>([])
  const products = ref<Product[]>([])
  /** Units sold per product on this terminal: best sellers go first in the grid. */
  const unitsSold = ref<Record<string, number>>({})
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [cats, prods, ranking] = await Promise.all([
        window.api.categories.list(),
        window.api.products.list(),
        window.api.products.salesRanking().catch(() => ({}))
      ])
      categories.value = cats
      unitsSold.value = ranking
      products.value = prods.filter((p) => p.active)
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** Top-level categories (the chips), ordered as the mirror returns them (by name). */
  const rootCategories = computed(() => categories.value.filter((c) => !c.parentId))

  /** Subcategories of a category (the second bar), in mirror order (by name). */
  function childrenOf(categoryId: string): Category[] {
    return categories.value.filter((c) => c.parentId === categoryId)
  }

  /** Whether some products sit directly on the category (in no subcategory). */
  function hasDirectProducts(categoryId: string): boolean {
    return products.value.some((p) => p.categoryId === categoryId)
  }

  /**
   * Products of a category plus those of its subcategories; narrowed to one
   * subcategory (or to {@link DIRECT_PRODUCTS}) when `subId` is given.
   */
  function productsFor(categoryId: string, subId = ''): Product[] {
    let list: Product[]
    if (subId === DIRECT_PRODUCTS) {
      list = products.value.filter((p) => p.categoryId === categoryId)
    } else if (subId) {
      list = products.value.filter((p) => p.categoryId === subId)
    } else {
      const ids = new Set([categoryId, ...childrenOf(categoryId).map((c) => c.id)])
      list = products.value.filter((p) => p.categoryId && ids.has(p.categoryId))
    }
    return bestSellersFirst(list)
  }

  /** Re-read the units sold (after a sale) so the best sellers move up. */
  async function refreshRanking(): Promise<void> {
    try {
      unitsSold.value = await window.api.products.salesRanking()
    } catch {
      /* keep the current order */
    }
  }

  /** Most units sold first; never-sold ones keep the alphabetical order. */
  function bestSellersFirst(list: Product[]): Product[] {
    const sold = unitsSold.value
    return [...list].sort(
      (a, b) => (sold[b.id] ?? 0) - (sold[a.id] ?? 0) || a.name.localeCompare(b.name, 'es')
    )
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
   * The accounting group of a category: always the one of its TOP-LEVEL category
   * (a subcategory never sends sales to another group).
   */
  function accountingGroupIdForCategory(categoryId: string | null): string | null {
    if (!categoryId) return null
    const category = categories.value.find((c) => c.id === categoryId)
    const root = category?.parentId
      ? (categories.value.find((c) => c.id === category.parentId) ?? category)
      : category
    return root?.accountingGroupId ?? null
  }

  /**
   * Resolve the accounting group a product rolls up into, via its category.
   * Snapshotted onto the sale line at checkout so the cierre stays stable.
   */
  function accountingGroupIdFor(productId: string): string | null {
    const product = products.value.find((p) => p.id === productId)
    return accountingGroupIdForCategory(product?.categoryId ?? null)
  }

  /**
   * Where lines sold by price only ("Producto" (no barcode), barcode not found) go: the
   * top-level "Tienda" category, falling back to the first top-level category.
   */
  function quickSaleCategory(): Category | null {
    const roots = rootCategories.value
    const norm = (s: string): string =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
    return roots.find((c) => norm(c.name) === 'tienda') ?? roots[0] ?? null
  }

  return {
    categories,
    products,
    loading,
    loaded,
    load,
    rootCategories,
    refreshRanking,
    childrenOf,
    hasDirectProducts,
    productsFor,
    searchProducts,
    findByBarcode,
    colorOf,
    accountingGroupIdFor,
    accountingGroupIdForCategory,
    quickSaleCategory
  }
})
