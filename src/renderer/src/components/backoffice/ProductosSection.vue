<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listCategories,
  type AdminProduct,
  type AdminCategory
} from '../../services/admin'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'

/**
 * Product catalog CRUD. Every product belongs to a category (mandatory). Backend-
 * owned, reached over HTTP (shared by web and desktop). Read needs `product:read`;
 * writes the matching perms. Prices are edited in euros and stored as integer
 * cents; the tax rate is edited as a percentage and stored as a fraction.
 */
const { can } = useCan()

const products = ref<AdminProduct[]>([])
const categories = ref<AdminCategory[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const form = reactive({
  barcode: '',
  name: '',
  priceEur: 0,
  taxPct: 21,
  categoryId: null as string | null,
  active: true
})

/** Category options labelled with their hierarchy ("Madre › Subcategoría"). */
const categoryOptions = computed(() => {
  const byId = new Map(categories.value.map((c) => [c.id, c]))
  return categories.value
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null
      return { id: c.id, label: parent ? `${parent.name} › ${c.name}` : c.name }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
})

const categoryLabel = computed(() => {
  const map = new Map(categoryOptions.value.map((o) => [o.id, o.label]))
  return (id: string | null): string => (id ? (map.get(id) ?? '—') : '—')
})

const filtered = computed<AdminProduct[]>(() =>
  fuzzySearch(products.value, search.value, (p) => [p.name, p.barcode])
)

function eur(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR'
  })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[products.value, categories.value] = await Promise.all([listProducts(), listCategories()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los productos'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.barcode = ''
  form.name = ''
  form.priceEur = 0
  form.taxPct = 21
  form.categoryId = null
  form.active = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(product: AdminProduct): void {
  editingId.value = product.id
  form.barcode = product.barcode ?? ''
  form.name = product.name
  form.priceEur = product.priceCents / 100
  form.taxPct = Math.round(product.taxRate * 100)
  form.categoryId = product.categoryId
  form.active = product.active
  formError.value = ''
  dialogOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    formError.value = 'El nombre es obligatorio'
    return
  }
  if (!form.categoryId) {
    formError.value = 'La categoría es obligatoria'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    barcode: form.barcode.trim() || null,
    name: form.name.trim(),
    priceCents: Math.round(form.priceEur * 100),
    taxRate: form.taxPct / 100,
    categoryId: form.categoryId,
    active: form.active
  }
  try {
    if (editingId.value) await updateProduct(editingId.value, body)
    else await createProduct(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar el producto'
  } finally {
    saving.value = false
  }
}

async function remove(product: AdminProduct): Promise<void> {
  if (!confirm(`¿Eliminar el producto "${product.name}"?`)) return
  try {
    await deleteProduct(product.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo eliminar el producto'
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button
        v-if="can('product:create')"
        label="Nuevo producto"
        icon="pi pi-plus"
        :disabled="categories.length === 0"
        @click="openCreate"
      />
      <span class="bo-spacer" />
      <InputText v-model="search" placeholder="Buscar por nombre o código…" class="bo-search" />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <p v-if="categories.length === 0 && !loading" class="bo-hint">
      Crea primero alguna <strong>Categoría</strong>: cada producto debe pertenecer a una.
    </p>

    <DataTable
      :value="filtered"
      :loading="loading"
      data-key="id"
      paginator
      :rows="12"
      class="bo-card"
    >
      <template #empty>
        <div class="bo-empty">No hay productos todavía.</div>
      </template>
      <Column field="name" header="Producto" sortable />
      <Column header="Categoría">
        <template #body="{ data }">{{ categoryLabel(data.categoryId) }}</template>
      </Column>
      <Column field="barcode" header="Código" style="width: 11rem">
        <template #body="{ data }">{{ data.barcode || '—' }}</template>
      </Column>
      <Column header="Precio" style="width: 8rem">
        <template #body="{ data }">
          <span class="pos-money">{{ eur(data.priceCents) }}</span>
        </template>
      </Column>
      <Column header="IVA" style="width: 6rem">
        <template #body="{ data }">{{ Math.round(data.taxRate * 100) }}%</template>
      </Column>
      <Column header="Estado" style="width: 7rem">
        <template #body="{ data }">
          <Tag
            :value="data.active ? 'Activo' : 'Inactivo'"
            :severity="data.active ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column
        v-if="can('product:update') || can('product:delete')"
        header="Acciones"
        style="width: 11rem"
      >
        <template #body="{ data }">
          <Button
            v-if="can('product:update')"
            label="Editar"
            text
            size="small"
            @click="openEdit(data)"
          />
          <Button
            v-if="can('product:delete')"
            label="Eliminar"
            severity="danger"
            text
            size="small"
            @click="remove(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editingId ? 'Editar producto' : 'Nuevo producto'"
      :style="{ width: '34rem' }"
    >
      <div class="bo-form">
        <label>Nombre</label>
        <InputText v-model="form.name" placeholder="p. ej. Agua mineral 1,5L" />

        <label>Categoría</label>
        <Select
          v-model="form.categoryId"
          :options="categoryOptions"
          option-label="label"
          option-value="id"
          placeholder="Selecciona una categoría"
          filter
        />

        <div class="bo-grid2">
          <div>
            <label>Precio (€)</label>
            <InputNumber
              v-model="form.priceEur"
              :min-fraction-digits="2"
              :max-fraction-digits="2"
              mode="decimal"
              fluid
            />
          </div>
          <div>
            <label>IVA (%)</label>
            <InputNumber v-model="form.taxPct" :min="0" :max="100" suffix=" %" fluid />
          </div>
        </div>

        <label>Código de barras (opcional)</label>
        <InputText v-model="form.barcode" placeholder="8412345000017" />

        <div class="bo-toggle">
          <ToggleSwitch v-model="form.active" />
          <span>{{ form.active ? 'Activo' : 'Inactivo' }}</span>
        </div>

        <span v-if="formError" class="bo-error">{{ formError }}</span>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="dialogOpen = false" />
        <Button label="Guardar" :loading="saving" @click="submit" />
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
.bo-hint {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}
.bo-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bo-form label {
  font-weight: 700;
  font-size: 13px;
  margin-top: 8px;
  color: var(--pos-green-dark);
}
.bo-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.bo-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  font-weight: 700;
  font-size: 14px;
  color: var(--pos-green-dark);
}
.bo-empty {
  padding: 18px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
