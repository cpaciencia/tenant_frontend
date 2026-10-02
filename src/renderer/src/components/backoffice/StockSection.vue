<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  listProducts,
  listCategories,
  setProductStock,
  type AdminProduct,
  type AdminCategory
} from '../../services/admin'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'

/**
 * Stock management (shared, backend-owned). Lists products with their stock and
 * lets you set an absolute level (PATCH). The till decrements stock on sale via
 * the backend projection; here you correct/replenish it. Read needs `product:read`,
 * adjusting needs `product:update`.
 */
const { can } = useCan()

const products = ref<AdminProduct[]>([])
const categories = ref<AdminCategory[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const editing = ref<AdminProduct | null>(null)
const newStock = ref(0)

const categoryName = computed(() => {
  const byId = new Map(categories.value.map((c) => [c.id, c]))
  return (id: string | null): string => (id ? (byId.get(id)?.name ?? '—') : '—')
})

const filtered = computed<AdminProduct[]>(() =>
  fuzzySearch(products.value, search.value, (p) => [p.name, p.barcode])
)

function stockSeverity(n: number): 'danger' | 'warn' | 'success' {
  if (n <= 5) return 'danger'
  if (n <= 20) return 'warn'
  return 'success'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[products.value, categories.value] = await Promise.all([listProducts(), listCategories()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el stock'
  } finally {
    loading.value = false
  }
}

function openAdjust(p: AdminProduct): void {
  editing.value = p
  newStock.value = p.stock
  dialogOpen.value = true
}

async function save(): Promise<void> {
  if (!editing.value || saving.value) return
  saving.value = true
  try {
    const updated = await setProductStock(editing.value.id, Math.max(0, Math.round(newStock.value)))
    const idx = products.value.findIndex((p) => p.id === updated.id)
    if (idx >= 0) products.value[idx] = updated
    dialogOpen.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo guardar el stock'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <span class="bo-spacer" />
      <InputText v-model="search" placeholder="Buscar producto…" class="bo-search" />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <DataTable
      :value="filtered"
      :loading="loading"
      data-key="id"
      paginator
      :rows="15"
      class="bo-card"
    >
      <template #empty><div class="st-empty">No hay productos.</div></template>
      <Column field="name" header="Producto" sortable />
      <Column header="Categoría">
        <template #body="{ data }">{{ categoryName(data.categoryId) }}</template>
      </Column>
      <Column field="barcode" header="Código" style="width: 11rem">
        <template #body="{ data }">{{ data.barcode || '—' }}</template>
      </Column>
      <Column header="Stock" sortable field="stock" style="width: 8rem">
        <template #body="{ data }">
          <Tag :value="String(data.stock)" :severity="stockSeverity(data.stock)" />
        </template>
      </Column>
      <Column v-if="can('product:update')" header="" style="width: 9rem">
        <template #body="{ data }">
          <Button label="Ajustar" text size="small" @click="openAdjust(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editing ? `Ajustar stock · ${editing.name}` : 'Ajustar stock'"
      :style="{ width: '26rem' }"
    >
      <div class="st-form">
        <label>Existencias</label>
        <InputNumber v-model="newStock" :min="0" showButtons fluid />
        <small>Fija el número de unidades en almacén (valor absoluto).</small>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="dialogOpen = false" />
        <Button label="Guardar" :loading="saving" @click="save" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.bo-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.bo-spacer {
  flex: 1;
}
.bo-search {
  width: 300px;
  max-width: 40vw;
}
.st-empty {
  padding: 16px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.st-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.st-form label {
  font-weight: 800;
  font-size: 13px;
  color: var(--pos-green-dark);
}
.st-form small {
  color: var(--pos-text-3);
  font-weight: 600;
  font-size: 12px;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
