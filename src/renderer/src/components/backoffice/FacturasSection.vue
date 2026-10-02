<script setup lang="ts">
/**
 * "Facturas de proveedores": the invoice files uploaded for the supplier payments
 * made from the tills (from the till itself or from a phone via QR). Read-only:
 * an invoice is the proof of a payment and is never replaced. Permission
 * `invoice:read`; web + desktop.
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  invoiceBlob,
  invoiceObjectUrl,
  listInvoices,
  type SupplierInvoice
} from '../../services/invoices'
import { eurCents } from '../../utils/activityFormat'
import PdfPreview from '../common/PdfPreview.vue'
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../utils/period'

const preset = ref<PeriodPreset>('30d')
const customRange = ref<(Date | null)[] | null>(null)
const period = computed(() => resolvePeriod(preset.value, customRange.value))

const invoices = ref<SupplierInvoice[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const opening = ref<string | null>(null)

const filtered = computed(() => {
  const q = search.value.trim().toLocaleLowerCase('es')
  if (!q) return invoices.value
  return invoices.value.filter((i) =>
    [i.supplierName, i.document, i.fileName, i.uploadedByName, i.terminalId]
      .filter(Boolean)
      .some((v) => v!.toLocaleLowerCase('es').includes(q))
  )
})
const totalCents = computed(() => filtered.value.reduce((n, i) => n + (i.amountCents ?? 0), 0))

async function load(): Promise<void> {
  if (preset.value === 'custom' && !customRange.value?.[1]) return
  loading.value = true
  error.value = ''
  try {
    invoices.value = await listInvoices(period.value.from, period.value.to)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar las facturas.'
  } finally {
    loading.value = false
  }
}
watch(period, load)
onMounted(load)

/** In-app preview (the desktop never opens blob: windows). */
const preview = ref<{ inv: SupplierInvoice; url: string; file: Blob } | null>(null)

async function open(inv: SupplierInvoice): Promise<void> {
  opening.value = inv.id
  error.value = ''
  try {
    const file = await invoiceBlob(inv.id)
    preview.value = { inv, url: URL.createObjectURL(file), file }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo abrir la factura.'
  } finally {
    opening.value = null
  }
}

function closePreview(): void {
  if (preview.value) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}

async function download(inv: SupplierInvoice): Promise<void> {
  opening.value = inv.id
  try {
    const url = await invoiceObjectUrl(inv.id)
    const a = document.createElement('a')
    a.href = url
    a.download = inv.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo descargar la factura.'
  } finally {
    opening.value = null
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
</script>

<template>
  <div class="fac">
    <div class="bo-card fac-bar">
      <div class="fac-presets">
        <button
          v-for="p in PERIOD_PRESETS"
          :key="p.id"
          class="fac-preset"
          :class="{ 'fac-preset--on': preset === p.id }"
          @click="preset = p.id"
        >
          {{ p.label }}
        </button>
      </div>
      <DatePicker
        v-if="preset === 'custom'"
        v-model="customRange"
        selection-mode="range"
        date-format="dd/mm/yy"
        placeholder="Desde – hasta"
        show-icon
        :manual-input="false"
      />
      <InputText v-model="search" placeholder="Buscar proveedor, nº, archivo…" class="fac-search" />
      <span class="fac-total">
        {{ filtered.length }} factura(s) · <b>{{ eurCents(totalCents) }}</b>
      </span>
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Actualizar" @click="load" />
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <div class="bo-card">
      <DataTable :value="filtered" :loading="loading" data-key="id" size="small" striped-rows>
        <template #empty>No hay facturas en este periodo.</template>
        <Column header="Subida" style="width: 150px">
          <template #body="{ data }">{{ fmtDateTime(data.uploadedAt) }}</template>
        </Column>
        <Column field="supplierName" header="Proveedor" />
        <Column header="Importe" style="width: 110px">
          <template #body="{ data }">
            <span class="pos-money">{{
              data.amountCents == null ? '—' : eurCents(data.amountCents)
            }}</span>
          </template>
        </Column>
        <Column header="Nº albarán/factura">
          <template #body="{ data }">{{ data.document ?? '—' }}</template>
        </Column>
        <Column field="terminalId" header="Terminal" style="width: 90px" />
        <Column header="Subida por">
          <template #body="{ data }">
            {{ data.uploadedByName ?? '—' }}
            <small class="fac-via">{{ data.uploadedVia === 'qr' ? 'móvil (QR)' : 'caja' }}</small>
          </template>
        </Column>
        <Column header="Archivo">
          <template #body="{ data }">
            <span class="fac-file">{{ data.fileName }}</span>
            <small class="fac-via">{{ fmtSize(data.sizeBytes) }}</small>
          </template>
        </Column>
        <Column style="width: 110px">
          <template #body="{ data }">
            <Button
              icon="pi pi-eye"
              text
              rounded
              aria-label="Ver"
              :loading="opening === data.id"
              @click="open(data)"
            />
            <Button
              icon="pi pi-download"
              text
              rounded
              aria-label="Descargar"
              :disabled="opening === data.id"
              @click="download(data)"
            />
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog
      :visible="!!preview"
      modal
      :header="preview ? `${preview.inv.supplierName ?? 'Factura'} · ${preview.inv.fileName}` : ''"
      :style="{ width: '80vw', maxWidth: '1000px' }"
      @update:visible="(v: boolean) => !v && closePreview()"
    >
      <template v-if="preview">
        <PdfPreview
          v-if="preview.inv.contentType === 'application/pdf'"
          :key="preview.url"
          :file="preview.file"
        />
        <img v-else :src="preview.url" alt="Factura" class="fac-img" />
        <div class="fac-preview-actions">
          <Button label="Descargar" icon="pi pi-download" @click="download(preview.inv)" />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.fac {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.fac-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
}
.fac-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.fac-preset {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.fac-preset--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.fac-search {
  min-width: 240px;
}
.fac-total {
  margin-left: auto;
  font-size: 14px;
}
.fac-via {
  display: block;
  color: var(--pos-text-3);
  font-size: 11px;
}
.fac-img {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
}
.fac-preview-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
.fac-file {
  word-break: break-all;
}
</style>
