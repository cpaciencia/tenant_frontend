<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { useCatalogStore } from '../../stores/catalog'
import { eur } from '../../data/catalog'
import type { Product } from '../../../../shared/types'

const store = usePosStore()
const catalog = useCatalogStore()
const { activeCat, search, buffer, hasBuffer } = storeToRefs(store)
const { rootCategories, loaded } = storeToRefs(catalog)

interface Tile {
  id: string
  name: string
  priceStr: string
  accent: string
}

function toTile(p: Product): Tile {
  return {
    id: p.id,
    name: p.name,
    priceStr: eur(p.priceCents / 100),
    accent: catalog.colorOf(p.categoryId)
  }
}

// When the search box has text, search across the whole catalog; otherwise show
// the products of the active category (and its subcategories).
const products = computed<Tile[]>(() => {
  const q = search.value.trim()
  const source = q ? catalog.searchProducts(q) : catalog.productsFor(activeCat.value)
  return source.map(toTile)
})

function add(product: Tile): void {
  store.addProduct(product.id, product.name, priceEurOf(product.id))
}

function priceEurOf(id: string): number {
  const p = catalog.products.find((x) => x.id === id)
  return p ? p.priceCents / 100 : 0
}

/** Enter in the search box adds the first matching product (quick keyboard add). */
function searchAdd(): void {
  const hit = catalog.searchProducts(search.value)[0]
  if (hit) {
    store.addProduct(hit.id, hit.name, hit.priceCents / 100)
    search.value = ''
  }
}

function clearSearch(): void {
  search.value = ''
}
// The barcode reader is handled app-wide (useGlobalScanner in App.vue): a scan
// adds the product automatically and jumps here, from any screen.

onMounted(() => {
  if (!loaded.value) catalog.load()
})

// Select the first category once the catalog has loaded (or if the active one
// disappears after a refresh).
watch(
  rootCategories,
  (cats) => {
    if (cats.length && !cats.some((c) => c.id === activeCat.value)) {
      activeCat.value = cats[0].id
    }
  },
  { immediate: true }
)
</script>

<template>
  <section class="grid-panel">
    <!-- Search / scanner + buffer indicator -->
    <div class="grid-panel__head">
      <div class="grid-panel__search">
        <i class="pi pi-search grid-panel__search-icon"></i>
        <input
          v-model="search"
          class="grid-panel__search-input"
          :class="{ 'grid-panel__search-input--clearable': search }"
          placeholder="Escanear código o buscar producto…"
          @keydown.enter="searchAdd()"
        />
        <button
          v-if="search"
          class="grid-panel__search-clear"
          title="Limpiar"
          @click="clearSearch"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>
      <div v-if="hasBuffer" class="grid-panel__buffer">
        × {{ buffer }}
        <button class="grid-panel__buffer-clear" @click="store.clearBuffer()">
          <i class="pi pi-times"></i>
        </button>
      </div>
    </div>

    <!-- Category chips -->
    <div class="grid-panel__cats">
      <button
        v-for="c in rootCategories"
        :key="c.id"
        class="chip"
        :class="{ 'chip--active': activeCat === c.id }"
        :style="
          activeCat === c.id
            ? {
                background: c.color || '#27ae60',
                color: '#fff',
                boxShadow: `0 4px 12px ${(c.color || '#27ae60') + '55'}`
              }
            : undefined
        "
        @click="activeCat = c.id"
      >
        <i class="pi" :class="c.icon || 'pi-tag'"></i> {{ c.name }}
      </button>
    </div>

    <!-- Product tiles -->
    <div class="grid-panel__tiles">
      <div v-if="loaded && products.length === 0" class="grid-panel__empty">
        <i class="pi pi-inbox"></i>
        <span>{{ search.trim() ? 'Sin resultados' : 'No hay productos en esta categoría' }}</span>
      </div>
      <div v-else class="grid-panel__tiles-grid">
        <button v-for="p in products" :key="p.id" class="tile" @click="add(p)">
          <span class="tile__accent" :style="{ background: p.accent }"></span>
          <span class="tile__name">{{ p.name }}</span>
          <span class="tile__price pos-money">{{ p.priceStr }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid-panel {
  grid-area: grid;
  display: flex;
  flex-direction: column;
  background: var(--pos-panel);
  border-radius: var(--pos-radius-panel);
  box-shadow: var(--pos-shadow-panel);
  overflow: hidden;
  min-height: 0;
}
.grid-panel__head {
  flex: 0 0 auto;
  padding: 14px 16px;
  border-bottom: 1px solid var(--pos-border-subtle);
  display: flex;
  gap: 12px;
  align-items: center;
}
.grid-panel__search {
  position: relative;
  flex: 1;
}
.grid-panel__search-icon {
  position: absolute;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--pos-text-3);
  font-size: 16px;
}
.grid-panel__search-input {
  width: 100%;
  height: 48px;
  padding: 0 16px 0 44px;
  font-size: 15px;
  border: 1.5px solid var(--pos-border-medium);
  border-radius: 11px;
  background: #f8fafc;
  outline: none;
  color: var(--pos-text);
}
.grid-panel__search-input--clearable {
  padding-right: 44px;
}
.grid-panel__search-input:focus {
  border-color: var(--pos-green);
  background: #fff;
}
.grid-panel__search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #e2e8f0;
  color: var(--pos-text-2);
  font-size: 13px;
  transition: all 0.12s ease;
}
.grid-panel__search-clear:hover {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.grid-panel__buffer {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  background: var(--pos-warn-bg);
  border: 1.5px solid var(--pos-warn-border);
  border-radius: 11px;
  color: var(--pos-warn);
  font-weight: 900;
  font-size: 16px;
}
.grid-panel__buffer-clear {
  background: none;
  color: var(--pos-warn);
  font-size: 14px;
  margin-left: 2px;
}
.grid-panel__cats {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 12px 14px 4px;
  overflow-x: auto;
}
.chip {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  height: 42px;
  padding: 0 16px;
  border-radius: 11px;
  font-size: 13.5px;
  font-weight: 800;
  flex: 0 0 auto;
  transition: all 0.12s ease;
  background: #f4f7f9;
  color: var(--pos-text-2);
}
.grid-panel__tiles {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 10px 14px 14px;
}
.grid-panel__tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
  gap: 11px;
}
.grid-panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--pos-text-3);
  font-weight: 700;
  font-size: 14px;
}
.grid-panel__empty i {
  font-size: 30px;
  opacity: 0.5;
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 104px;
  padding: 12px;
  background: #fff;
  border: 1.5px solid var(--pos-border-subtle);
  border-radius: var(--pos-radius-tile);
  text-align: left;
  transition: all 0.12s ease;
  overflow: hidden;
}
.tile:hover {
  border-color: var(--pos-green);
  box-shadow: 0 6px 16px rgba(39, 174, 96, 0.15);
  transform: translateY(-2px);
}
.tile:active {
  transform: scale(0.97);
}
.tile__accent {
  position: absolute;
  top: 0;
  left: 0;
  width: 5px;
  height: 100%;
}
.tile__name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--pos-text);
  line-height: 1.25;
  padding-left: 4px;
}
.tile__price {
  font-size: 18px;
  color: var(--pos-green-dark);
  padding-left: 4px;
}
</style>
