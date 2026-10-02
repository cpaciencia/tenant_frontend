<script setup lang="ts">
/**
 * "Proveedores": the suppliers the tills pay (added on the fly at the till, or
 * here). Shows what was paid to each and how many payments still lack their
 * invoice. Adding/editing needs `supplier:manage`; a deactivated supplier
 * disappears from the tills' list (its history stays). Web + desktop (HTTP).
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createSupplier,
  listSupplierSummaries,
  updateSupplier,
  type SupplierSummary
} from '../../services/suppliers'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'
import { eurCents } from '../../utils/activityFormat'

const { can } = useCan()
const canManage = computed(() => can('supplier:manage'))

const suppliers = ref<SupplierSummary[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const showInactive = ref(false)

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const form = reactive({ name: '', taxId: '', phone: '', active: true })

const filtered = computed(() =>
  fuzzySearch(
    suppliers.value.filter((s) => showInactive.value || s.active),
    search.value,
    (s) => [s.name, s.taxId ?? '', s.phone ?? '']
  )
)
const missingTotal = computed(() => suppliers.value.reduce((n, s) => n + s.invoicesMissing, 0))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    suppliers.value = await listSupplierSummaries()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los proveedores'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  Object.assign(form, { name: '', taxId: '', phone: '', active: true })
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(s: SupplierSummary): void {
  editingId.value = s.id
  Object.assign(form, {
    name: s.name,
    taxId: s.taxId ?? '',
    phone: s.phone ?? '',
    active: s.active
  })
  formError.value = ''
  dialogOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    formError.value = 'El nombre es obligatorio'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    name: form.name.trim(),
    taxId: form.taxId.trim() || null,
    phone: form.phone.trim() || null,
    active: form.active
  }
  try {
    if (editingId.value) await updateSupplier(editingId.value, body)
    else await createSupplier(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar el proveedor'
  } finally {
    saving.value = false
  }
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-ES') : '—'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button v-if="canManage" label="Nuevo proveedor" icon="pi pi-plus" @click="openCreate" />
      <span v-if="missingTotal > 0" class="sup-missing">
        <i class="pi pi-exclamation-triangle"></i> {{ missingTotal }} pago(s) sin factura
      </span>
      <span class="bo-spacer" />
      <label class="bo-toggle bo-toggle--inline">
        <ToggleSwitch v-model="showInactive" /> Ver inactivos
      </label>
      <InputText
        v-model="search"
        placeholder="Buscar por nombre, CIF o teléfono…"
        class="bo-search"
      />
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Actualizar" @click="load" />
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <DataTable :value="filtered" :loading="loading" data-key="id" class="bo-card">
      <template #empty>
        <div class="bo-empty">
          No hay proveedores. Se añaden aquí o al pagar a un proveedor desde la caja.
        </div>
      </template>
      <Column field="name" header="Proveedor" sortable />
      <Column header="CIF / NIF" style="width: 9rem">
        <template #body="{ data }">{{ data.taxId ?? '—' }}</template>
      </Column>
      <Column header="Teléfono" style="width: 9rem">
        <template #body="{ data }">{{ data.phone ?? '—' }}</template>
      </Column>
      <Column field="paymentsCount" header="Pagos" sortable style="width: 6rem" />
      <Column field="paidCents" header="Pagado" sortable style="width: 8rem">
        <template #body="{ data }"
          ><span class="pos-money">{{ eurCents(data.paidCents) }}</span></template
        >
      </Column>
      <Column field="invoicesMissing" header="Sin factura" sortable style="width: 7rem">
        <template #body="{ data }">
          <Tag
            v-if="data.invoicesMissing > 0"
            :value="String(data.invoicesMissing)"
            severity="danger"
          />
          <span v-else class="sup-ok"><i class="pi pi-check"></i></span>
        </template>
      </Column>
      <Column field="lastPaymentAt" header="Último pago" sortable style="width: 8rem">
        <template #body="{ data }">{{ fmtDate(data.lastPaymentAt) }}</template>
      </Column>
      <Column header="Estado" style="width: 7rem">
        <template #body="{ data }">
          <Tag
            :value="data.active ? 'Activo' : 'Inactivo'"
            :severity="data.active ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column v-if="canManage" header="" style="width: 6rem">
        <template #body="{ data }">
          <Button label="Editar" text size="small" @click="openEdit(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editingId ? 'Editar proveedor' : 'Nuevo proveedor'"
      :style="{ width: '30rem' }"
    >
      <div class="bo-form">
        <label>Nombre</label>
        <InputText v-model="form.name" placeholder="p. ej. Coca-Cola" />
        <label>CIF / NIF <small>(opcional)</small></label>
        <InputText v-model="form.taxId" />
        <label>Teléfono <small>(opcional)</small></label>
        <InputText v-model="form.phone" />
        <div class="bo-toggle">
          <ToggleSwitch v-model="form.active" />
          <span>{{ form.active ? 'Activo' : 'Inactivo (no aparece en las cajas)' }}</span>
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
  flex-wrap: wrap;
}
.bo-spacer {
  flex: 1;
}
.bo-search {
  width: 280px;
  max-width: 40vw;
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
.bo-form small {
  font-weight: 600;
  color: var(--pos-text-3);
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
.bo-toggle--inline {
  margin-top: 0;
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
.sup-missing {
  color: var(--pos-danger);
  font-weight: 800;
  font-size: 14px;
}
.sup-ok {
  color: var(--pos-green-hover);
}
</style>
