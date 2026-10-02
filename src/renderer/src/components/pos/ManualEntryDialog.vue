<script setup lang="ts">
/**
 * A scanned barcode that isn't in the catalog: sell it by price. The code is
 * kept; the price is mandatory, name and category can be filled now or later.
 * The line goes into the ticket and, once paid, becomes a pending item (blinking
 * badge next to "Cerrar caja") to be completed into a real product. Without a
 * chosen category it goes to "Tienda". (Items with no barcode at all use the
 * "Producto" (no barcode) button instead.)
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { useCatalogStore } from '../../stores/catalog'
import MoneyInput from '../common/MoneyInput.vue'

const store = usePosStore()
const catalog = useCatalogStore()
const { manualEntry, buffer } = storeToRefs(store)

const priceEur = ref<number | null>(null)
const name = ref('')
const categoryId = ref<string | null>(catalog.quickSaleCategory()?.id ?? null)
const error = ref('')

const quantity = computed(() => Math.max(1, parseInt(buffer.value, 10) || 1))

/** Categories labelled with their hierarchy ("Tienda › Agua"). */
const categoryOptions = computed(() => {
  const byId = new Map(catalog.categories.map((c) => [c.id, c]))
  return catalog.categories
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null
      return { id: c.id, label: parent ? `${parent.name} › ${c.name}` : c.name }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
})

onMounted(async () => {
  await nextTick()
  document.getElementById('me-price')?.focus()
})

function close(): void {
  manualEntry.value = null
}

function add(): void {
  const entry = manualEntry.value
  if (!entry) return
  if (priceEur.value === null || priceEur.value === 0) {
    error.value = 'Indica el precio.'
    return
  }
  const typedName = name.value.trim() || null
  store.addManualLine(typedName ?? `Código ${entry.barcode}`, priceEur.value, {
    kind: 'not_found',
    barcode: entry.barcode,
    name: typedName,
    categoryId: categoryId.value
  })
  close()
}
</script>

<template>
  <div class="me-overlay" @click.self="close">
    <div class="me-card">
      <div class="me-icon me-icon--warn"><i class="pi pi-question-circle"></i></div>
      <div class="me-title">Código no encontrado</div>
      <div class="me-code">{{ manualEntry?.barcode }}</div>
      <div class="me-sub">
        Pon el precio para venderlo ya. El resto lo puedes rellenar ahora o después.
      </div>

      <label class="me-label" for="me-price">
        Precio
        <small v-if="quantity > 1">× {{ quantity }} uds</small>
      </label>
      <MoneyInput id="me-price" v-model="priceEur" fluid @keydown.enter="add" />

      <label class="me-label" for="me-name">Nombre <small>(opcional)</small></label>
      <InputText
        id="me-name"
        v-model="name"
        placeholder="p. ej. Crema solar 50"
        fluid
        @keydown.enter="add"
      />

      <label class="me-label">Categoría <small>(opcional)</small></label>
      <Select
        v-model="categoryId"
        :options="categoryOptions"
        option-label="label"
        option-value="id"
        filter
        placeholder="Tienda"
        fluid
      />

      <span v-if="error" class="me-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <div class="me-foot">
        <button class="me-cancel" @click="close">Cancelar</button>
        <button class="me-add" @click="add">AÑADIR AL TICKET</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.me-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2600;
}
.me-card {
  width: 420px;
  max-width: 92vw;
  background: #fff;
  border-radius: 18px;
  padding: 26px 26px 20px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  box-shadow: var(--pos-shadow-modal);
}
.me-icon {
  width: 60px;
  height: 60px;
  margin: 0 auto;
  border-radius: 50%;
  background: var(--pos-green-soft);
  color: var(--pos-green);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
}
.me-icon--warn {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.me-title {
  text-align: center;
  font-size: 20px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.me-code {
  text-align: center;
  font-family: ui-monospace, monospace;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--pos-text);
}
.me-sub {
  text-align: center;
  font-size: 13px;
  color: var(--pos-text-2);
  margin-bottom: 4px;
}
.me-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 2px;
}
.me-label small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.me-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.me-foot {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.me-cancel {
  height: 50px;
  padding: 0 18px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  font-weight: 800;
  border-radius: 11px;
}
.me-add {
  flex: 1;
  height: 50px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 900;
  letter-spacing: 0.03em;
  border-radius: 11px;
}
</style>
