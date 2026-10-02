<script setup lang="ts">
/**
 * The "Pendientes" inbox: everything at the till still to be completed.
 *
 * 1. Supplier payments whose invoice isn't on the server yet (they block the
 *    cierre) — "Subir factura" opens the upload (file or QR) for that payment.
 * 2. Lines sold by price without a catalog product ("Producto" (no barcode) or a scanned
 * code that wasn't found), waiting to be identified. From here the cashier either
 * completes one — creating the real product on the server, which links those sales
 * to it and makes the barcode scannable from then on — or deletes it from the list.
 * Both actions are recorded in the audit log with who did them.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { usePosStore } from '../../stores/pos'
import { useCatalogStore } from '../../stores/catalog'
import { useAuthStore } from '../../stores/auth'
import { useCan } from '../../composables/useCan'
import { eur } from '../../data/catalog'
import { completePendingOnServer } from '../../services/admin'
import MoneyInput from '../common/MoneyInput.vue'
import type { CashMovement, PendingItem } from '../../../../shared/types'

const emit = defineEmits<{ (e: 'close'): void; (e: 'invoice', movementId: string): void }>()

const store = usePosStore()
const catalog = useCatalogStore()
const auth = useAuthStore()
const { can } = useCan()

const items = ref<PendingItem[]>([])
/** Supplier payments of the open caja still waiting for their invoice. */
const invoices = ref<CashMovement[]>([])
const nothingPending = computed(() => items.value.length === 0 && invoices.value.length === 0)
const loading = ref(true)
const error = ref('')
/** The item being completed (form open), and the one awaiting delete confirmation. */
const editing = ref<PendingItem | null>(null)
const confirmingDelete = ref<string | null>(null)
const busy = ref(false)

const TAX_OPTIONS = [
  { label: '21 %', value: 0.21 },
  { label: '10 %', value: 0.1 },
  { label: '4 %', value: 0.04 },
  { label: '0 %', value: 0 }
]
const form = reactive({
  name: '',
  categoryId: null as string | null,
  priceEur: null as number | null,
  costEur: null as number | null,
  taxRate: 0.21,
  barcode: ''
})

// Anyone who sells at the till may identify what they sold by price.
const canComplete = computed(() => can('pending_item:resolve') || can('pos:sell'))
const online = computed(() => Boolean(auth.token))

const categoryOptions = computed(() => {
  const byId = new Map(catalog.categories.map((c) => [c.id, c]))
  return catalog.categories
    .map((c) => {
      const parent = c.parentId ? byId.get(c.parentId) : null
      return { id: c.id, label: parent ? `${parent.name} › ${c.name}` : c.name }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
})

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [pending, movements] = await Promise.all([
      window.api.pendingItems.list(),
      window.api.cashMovements.current()
    ])
    items.value = pending
    invoices.value = movements.list.filter((m) => m.invoiceStatus === 'pending')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los pendientes.'
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  await store.reconcileInvoices()
  await load()
})

function startComplete(item: PendingItem): void {
  error.value = ''
  confirmingDelete.value = null
  editing.value = item
  form.name = item.name ?? ''
  form.categoryId = item.categoryId ?? catalog.quickSaleCategory()?.id ?? null
  form.priceEur = item.priceCents / 100
  form.costEur = null
  form.taxRate = 0.21
  form.barcode = item.barcode ?? ''
}

async function saveProduct(): Promise<void> {
  const item = editing.value
  if (!item || busy.value) return
  if (!form.name.trim() || !form.categoryId || form.priceEur === null) {
    error.value = 'Nombre, categoría y precio son obligatorios.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const { product } = await completePendingOnServer(item.id, {
      name: form.name.trim(),
      categoryId: form.categoryId,
      priceCents: Math.round(form.priceEur * 100),
      costCents: Math.max(0, Math.round((form.costEur ?? 0) * 100)),
      taxRate: form.taxRate,
      barcode: form.barcode.trim() || null
    })
    await window.api.pendingItems.complete({
      id: item.id,
      productId: product.id,
      actor: store.actor()
    })
    editing.value = null
    await afterChange()
    // Pull the new product so its barcode scans from now on (best-effort).
    window.api.catalog
      .refresh()
      .then(() => catalog.load())
      .catch(() => {})
  } catch (e) {
    const status = (e as { status?: number }).status
    error.value =
      status === 401 || status === 403
        ? 'El servidor no acepta tu sesión (caducada). Cierra sesión y vuelve a entrar.'
        : e instanceof Error
          ? e.message
          : 'No se pudo crear el producto.'
  } finally {
    busy.value = false
  }
}

async function remove(item: PendingItem): Promise<void> {
  if (confirmingDelete.value !== item.id) {
    confirmingDelete.value = item.id
    return
  }
  busy.value = true
  error.value = ''
  try {
    await window.api.pendingItems.dismiss({ id: item.id, actor: store.actor() })
    confirmingDelete.value = null
    await afterChange()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo borrar.'
  } finally {
    busy.value = false
  }
}

async function afterChange(): Promise<void> {
  await load()
  await store.refreshPendingCount()
}
</script>

<template>
  <div class="pi-overlay" @click.self="emit('close')">
    <div class="pi-card">
      <div class="pi-head">
        <div>
          <div class="pi-title">Pendientes</div>
          <div class="pi-sub">Lo que falta por completar en la caja.</div>
        </div>
        <button class="pi-close" @click="emit('close')"><i class="pi pi-times"></i></button>
      </div>

      <div v-if="!canComplete && items.length" class="pi-note">
        Tu usuario no puede crear productos: puedes borrar pendientes, pero completarlos lo tiene
        que hacer alguien con permiso.
      </div>
      <div v-else-if="!online && !nothingPending" class="pi-note">
        Tu sesión no está conectada al servidor (sin conexión o caducada). Cierra sesión y vuelve a
        entrar con conexión para subir facturas y completar productos; borrar productos sí puedes
        ahora.
      </div>
      <span v-if="error" class="pi-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <div class="pi-body">
        <div v-if="loading" class="pi-empty">Cargando…</div>
        <div v-else-if="nothingPending" class="pi-empty">
          <i class="pi pi-check-circle"></i> No hay nada pendiente.
        </div>

        <template v-if="invoices.length">
          <div class="pi-section">
            <i class="pi pi-file"></i> Facturas de proveedores por subir
            <small>Sin ellas no se puede cerrar la caja.</small>
          </div>
          <div v-for="m in invoices" :key="m.id" class="pi-item">
            <div class="pi-row">
              <span class="pi-kind pi-kind--inv">Factura</span>
              <div class="pi-main">
                <div class="pi-name">{{ m.supplier }}</div>
                <div class="pi-meta">
                  Pago a proveedor · {{ fmtTime(m.createdAt) }} · {{ m.userName }}
                  <template v-if="m.document"> · {{ m.document }}</template>
                </div>
              </div>
              <div class="pi-price pos-money">{{ eur(m.amountCents / 100) }}</div>
              <button class="pi-btn pi-btn--ok" @click="emit('invoice', m.id)">
                <i class="pi pi-upload"></i> Subir factura
              </button>
            </div>
          </div>
        </template>

        <div v-if="items.length" class="pi-section">
          <i class="pi pi-box"></i> Productos sin identificar
          <small>Vendidos por precio (botón «Producto» o código no encontrado).</small>
        </div>

        <div v-for="item in items" :key="item.id" class="pi-item">
          <div class="pi-row">
            <span class="pi-kind" :class="{ 'pi-kind--nf': item.kind === 'not_found' }">
              {{ item.kind === 'not_found' ? 'No encontrado' : 'Sin código' }}
            </span>
            <div class="pi-main">
              <div class="pi-name">
                {{ item.name || (item.barcode ? `Código ${item.barcode}` : 'Sin identificar') }}
              </div>
              <div class="pi-meta">
                {{ item.ticketNumber }} · {{ fmtTime(item.createdAt) }} · {{ item.createdByName }}
                <template v-if="item.barcode"> · {{ item.barcode }}</template>
              </div>
            </div>
            <div class="pi-price pos-money">
              {{ eur(item.priceCents / 100)
              }}<small v-if="item.quantity > 1"> × {{ item.quantity }}</small>
            </div>
            <button
              class="pi-btn pi-btn--ok"
              :disabled="busy || !canComplete || !online"
              @click="startComplete(item)"
            >
              Completar
            </button>
            <button class="pi-btn pi-btn--del" :disabled="busy" @click="remove(item)">
              {{ confirmingDelete === item.id ? '¿Seguro?' : 'Borrar' }}
            </button>
          </div>

          <!-- Completion form: creates the real product -->
          <div v-if="editing?.id === item.id" class="pi-form">
            <div class="pi-grid">
              <div class="pi-field pi-field--wide">
                <label>Nombre</label>
                <InputText v-model="form.name" placeholder="p. ej. Crema solar 50" fluid />
              </div>
              <div class="pi-field pi-field--wide">
                <label>Categoría</label>
                <Select
                  v-model="form.categoryId"
                  :options="categoryOptions"
                  option-label="label"
                  option-value="id"
                  filter
                  fluid
                />
              </div>
              <div class="pi-field">
                <label>Precio venta</label>
                <MoneyInput v-model="form.priceEur" allow-negative fluid />
              </div>
              <div class="pi-field">
                <label>Precio compra</label>
                <MoneyInput v-model="form.costEur" :max-fraction-digits="4" fluid />
              </div>
              <div class="pi-field">
                <label>IVA</label>
                <Select
                  v-model="form.taxRate"
                  :options="TAX_OPTIONS"
                  option-label="label"
                  option-value="value"
                  fluid
                />
              </div>
              <div class="pi-field">
                <label>Código de barras</label>
                <InputText v-model="form.barcode" fluid />
              </div>
            </div>
            <div class="pi-form-foot">
              <button class="pi-btn" :disabled="busy" @click="editing = null">Cancelar</button>
              <button class="pi-btn pi-btn--ok" :disabled="busy" @click="saveProduct">
                {{ busy ? 'GUARDANDO…' : 'CREAR PRODUCTO' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pi-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.pi-card {
  width: 860px;
  max-width: 94vw;
  max-height: 90vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: var(--pos-shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pi-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 22px;
  background: var(--pos-green-dark);
  color: #fff;
}
.pi-title {
  font-size: 18px;
  font-weight: 900;
}
.pi-sub {
  font-size: 12px;
  opacity: 0.8;
  font-weight: 600;
}
.pi-close {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.pi-note {
  margin: 12px 22px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  font-size: 13px;
  font-weight: 700;
}
.pi-error {
  margin: 10px 22px 0;
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.pi-body {
  padding: 12px 22px 20px;
  overflow-y: auto;
}
.pi-empty {
  padding: 30px 0;
  text-align: center;
  color: var(--pos-text-3);
  font-weight: 700;
}
.pi-item {
  border: 1px solid var(--pos-border-subtle);
  border-radius: 12px;
  margin-top: 10px;
}
.pi-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}
.pi-kind {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.pi-section {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin: 6px 0 2px;
  font-size: 14px;
  font-weight: 900;
  color: var(--pos-text);
}
.pi-section small {
  font-weight: 600;
  font-size: 12px;
  color: var(--pos-text-3);
}
.pi-kind--inv {
  background: var(--pos-danger-bg-soft);
  color: var(--pos-danger);
}
.pi-kind--nf {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.pi-main {
  flex: 1;
  min-width: 0;
}
.pi-name {
  font-weight: 800;
  color: var(--pos-text);
}
.pi-meta {
  font-size: 12px;
  color: var(--pos-text-3);
}
.pi-price {
  font-weight: 900;
  color: var(--pos-green-dark);
  white-space: nowrap;
}
.pi-btn {
  height: 38px;
  padding: 0 14px;
  border-radius: 9px;
  font-weight: 800;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  white-space: nowrap;
}
.pi-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pi-btn--ok {
  background: var(--pos-green);
  color: #fff;
}
.pi-btn--del {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.pi-form {
  border-top: 1px dashed var(--pos-border-medium);
  padding: 12px;
  background: #fbfcfd;
  border-radius: 0 0 12px 12px;
}
.pi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.pi-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pi-field--wide {
  grid-column: span 2;
}
.pi-field label {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.pi-form-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
</style>
