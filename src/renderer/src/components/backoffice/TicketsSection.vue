<script setup lang="ts">
/**
 * Ticket browser (web + desktop, `sale:read`). Filters by period, terminal, caja
 * (shift / Z), seller, payment method, ticket number or product, and tickets with
 * lines sold by price. Each ticket opens with when/where/who, its caja, how it was
 * paid, its lines (category, accounting group, manual lines) and its whole story
 * from the audit log (lines added/removed, payment opened, parked…).
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  getTicketFull,
  listTicketCajas,
  listTicketSellers,
  searchTickets,
  type CajaOption,
  type TicketFull,
  type TicketRow
} from '../../services/admin'
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../utils/period'
import { describeEvent, suspicionOf, typeMeta } from '../../utils/activityFormat'

const PAGE_SIZE = 50
const METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'mixto', label: 'Mixto' },
  { value: 'a_cuenta', label: 'A cuenta' }
]
const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.value, m.label])
)

const preset = ref<PeriodPreset>('7d')
const customRange = ref<(Date | null)[] | null>(null)
const period = computed(() => resolvePeriod(preset.value, customRange.value))

const filters = reactive({
  terminal: null as string | null,
  caja: null as string | null,
  seller: null as string | null,
  method: null as string | null,
  q: '',
  manualOnly: false
})
const cajas = ref<CajaOption[]>([])
const sellers = ref<string[]>([])
const terminals = computed(() => [...new Set(cajas.value.map((c) => c.terminalId))].sort())

const rows = ref<TicketRow[]>([])
const total = ref(0)
const totalCents = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref('')

const detail = ref<TicketFull | null>(null)
const detailLoading = ref(false)

function eur(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
function fmtDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
    : '—'
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
function fmtDay(date: string | null): string {
  if (!date) return ''
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}
function cajaLabel(c: {
  terminalId: string
  shiftName: string | null
  businessDate: string | null
  zNumber: number | null
}): string {
  return [
    c.terminalId,
    [c.shiftName, fmtDay(c.businessDate)].filter(Boolean).join(' ') || 'sin turno',
    c.zNumber != null ? `Z ${c.zNumber}` : 'abierta'
  ].join(' · ')
}
const cajaOptions = computed(() =>
  cajas.value.map((c) => ({
    value: c.cashSessionId,
    label: `${cajaLabel(c)}${c.responsibleName ? ` · ${c.responsibleName}` : ''}`
  }))
)

async function loadOptions(): Promise<void> {
  try {
    ;[cajas.value, sellers.value] = await Promise.all([
      listTicketCajas(period.value.from, period.value.to),
      listTicketSellers(period.value.from, period.value.to)
    ])
  } catch {
    /* filters are optional */
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await searchTickets({
      ...period.value,
      ...filters,
      page: page.value,
      size: PAGE_SIZE
    })
    rows.value = result.items
    total.value = result.total
    totalCents.value = result.totalCents
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los tickets'
  } finally {
    loading.value = false
  }
}

function onPage(e: { page: number }): void {
  page.value = e.page
  void load()
}

async function openDetail(t: TicketRow): Promise<void> {
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getTicketFull(t.saleId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el ticket'
  } finally {
    detailLoading.value = false
  }
}

function filterByCaja(t: TicketRow): void {
  if (t.cashSessionId) filters.caja = t.cashSessionId
}
function clearFilters(): void {
  Object.assign(filters, {
    terminal: null,
    caja: null,
    seller: null,
    method: null,
    q: '',
    manualOnly: false
  })
}

watch(period, async () => {
  filters.caja = null
  page.value = 0
  await loadOptions()
  await load()
})
watch(
  () => ({ ...filters }),
  () => {
    page.value = 0
    void load()
  },
  { deep: true }
)

onMounted(async () => {
  await loadOptions()
  await load()
})
</script>

<template>
  <div class="tk">
    <!-- Filters -->
    <div class="bo-card tk-bar">
      <div class="tk-presets">
        <button
          v-for="p in PERIOD_PRESETS"
          :key="p.id"
          class="tk-preset"
          :class="{ 'tk-preset--on': preset === p.id }"
          @click="preset = p.id"
        >
          {{ p.label }}
        </button>
        <DatePicker
          v-if="preset === 'custom'"
          v-model="customRange"
          selection-mode="range"
          date-format="dd/mm/yy"
          placeholder="Desde – hasta"
          show-icon
          :manual-input="false"
          class="tk-range"
        />
      </div>
      <div class="tk-filters">
        <Select
          v-model="filters.caja"
          :options="cajaOptions"
          option-label="label"
          option-value="value"
          placeholder="Todas las cajas"
          show-clear
          filter
          class="tk-f tk-f--wide"
        />
        <Select
          v-model="filters.terminal"
          :options="terminals"
          placeholder="Todos los terminales"
          show-clear
          class="tk-f"
        />
        <Select
          v-model="filters.seller"
          :options="sellers"
          placeholder="Todos los vendedores"
          show-clear
          filter
          class="tk-f"
        />
        <Select
          v-model="filters.method"
          :options="METHODS"
          option-label="label"
          option-value="value"
          placeholder="Cualquier forma de pago"
          show-clear
          class="tk-f"
        />
        <InputText
          v-model.lazy="filters.q"
          placeholder="Nº de ticket, producto o código…"
          class="tk-f tk-f--wide"
        />
        <label class="tk-toggle">
          <ToggleSwitch v-model="filters.manualOnly" /> Solo con líneas sin código
        </label>
        <Button label="Limpiar" icon="pi pi-filter-slash" text @click="clearFilters" />
        <Button
          icon="pi pi-refresh"
          text
          :loading="loading"
          aria-label="Actualizar"
          @click="load"
        />
      </div>
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <div class="tk-summary">
      <b>{{ total }}</b> tickets · <b class="pos-money">{{ eur(totalCents) }}</b>
      <span class="tk-summary__period">{{ fmtDay(period.from) }} – {{ fmtDay(period.to) }}</span>
    </div>

    <DataTable
      :value="rows"
      :loading="loading"
      data-key="saleId"
      lazy
      paginator
      :rows="PAGE_SIZE"
      :total-records="total"
      :first="page * PAGE_SIZE"
      class="bo-card"
      size="small"
      row-hover
      @page="onPage"
      @row-click="(e) => openDetail(e.data)"
    >
      <template #empty><div class="bo-empty">No hay tickets con estos filtros.</div></template>
      <Column header="Fecha y hora" style="width: 11rem">
        <template #body="{ data }"
          ><span class="tk-when">{{ fmtDateTime(data.createdAt) }}</span></template
        >
      </Column>
      <Column field="ticketNumber" header="Ticket" style="width: 10rem" />
      <Column header="Caja">
        <template #body="{ data }">
          <button
            v-if="data.cashSessionId"
            class="tk-link"
            title="Ver solo esta caja"
            @click.stop="filterByCaja(data)"
          >
            {{ cajaLabel(data) }}
          </button>
          <span v-else class="tk-muted">—</span>
        </template>
      </Column>
      <Column header="Vendedor">
        <template #body="{ data }">
          <button
            v-if="data.sellerName"
            class="tk-link"
            @click.stop="filters.seller = data.sellerName"
          >
            {{ data.sellerName }}
          </button>
        </template>
      </Column>
      <Column header="Pago" style="width: 9rem">
        <template #body="{ data }">
          <span class="tk-method" :class="`tk-method--${data.paymentMethod}`">{{
            METHOD_LABEL[data.paymentMethod] ?? data.paymentMethod
          }}</span>
          <div v-if="data.creditClient" class="tk-muted">{{ data.creditClient }}</div>
        </template>
      </Column>
      <Column header="Líneas" style="width: 7rem">
        <template #body="{ data }">
          {{ data.lines }}
          <span
            v-if="data.manualLines"
            class="tk-manual"
            title="Líneas vendidas por precio, sin código"
          >
            {{ data.manualLines }} sin código
          </span>
        </template>
      </Column>
      <Column header="Total" style="width: 8rem">
        <template #body="{ data }">
          <b class="pos-money" :class="{ 'tk-neg': data.totalCents < 0 }">{{
            eur(data.totalCents)
          }}</b>
        </template>
      </Column>
    </DataTable>

    <!-- Ticket detail -->
    <Dialog
      :visible="detail !== null || detailLoading"
      modal
      :style="{ width: '58rem' }"
      :header="detail ? `Ticket ${detail.ticket.ticketNumber}` : 'Cargando…'"
      @update:visible="
        (v: boolean) => {
          if (!v) detail = null
        }
      "
    >
      <div v-if="detail" class="tk-detail">
        <div class="tk-grid">
          <div>
            <span>Fecha y hora</span><b>{{ fmtDateTime(detail.ticket.createdAt) }}</b>
          </div>
          <div>
            <span>Terminal</span><b>{{ detail.ticket.terminalId }}</b>
          </div>
          <div>
            <span>Vendedor</span><b>{{ detail.ticket.sellerName ?? '—' }}</b>
          </div>
          <div>
            <span>Caja</span><b>{{ cajaLabel(detail.ticket) }}</b>
            <small
              >{{ detail.ticket.cajaStatus === 'closed' ? 'cerrada' : 'abierta' }}
              <template v-if="detail.ticket.cajaResponsible">
                · responsable {{ detail.ticket.cajaResponsible }}</template
              ></small
            >
          </div>
          <div>
            <span>Forma de pago</span>
            <b>{{ METHOD_LABEL[detail.ticket.paymentMethod] ?? detail.ticket.paymentMethod }}</b>
            <small>
              <template v-if="detail.ticket.cashCents"
                >efectivo {{ eur(detail.ticket.cashCents) }}
              </template>
              <template v-if="detail.ticket.cardCents"
                >· tarjeta {{ eur(detail.ticket.cardCents) }}
              </template>
              <template v-if="detail.ticket.creditCents"
                >· a cuenta {{ eur(detail.ticket.creditCents) }} ({{
                  detail.ticket.creditClient ?? 'sin cliente'
                }})</template
              >
            </small>
          </div>
          <div>
            <span>Total</span><b class="pos-money">{{ eur(detail.ticket.totalCents) }}</b>
          </div>
        </div>

        <div class="tk-title">Líneas</div>
        <table class="tk-lines">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Grupo</th>
              <th class="num">Cant.</th>
              <th class="num">Precio</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in detail.lines" :key="i">
              <td>
                {{ l.productName ?? '—' }}
                <span v-if="l.manual" class="tk-manual">{{
                  l.manualKind === 'not_found'
                    ? `código no encontrado ${l.manualBarcode ?? ''}`
                    : 'sin código'
                }}</span>
                <div v-if="l.barcode" class="tk-muted">{{ l.barcode }}</div>
              </td>
              <td>{{ [l.topCategory, l.subcategory].filter(Boolean).join(' › ') || '—' }}</td>
              <td>{{ l.accountingGroup ?? '—' }}</td>
              <td class="num">{{ l.quantity }}</td>
              <td class="num pos-money">{{ eur(l.unitPriceCents) }}</td>
              <td class="num pos-money">{{ eur(l.lineCents) }}</td>
            </tr>
          </tbody>
        </table>

        <div class="tk-title">Historia del ticket</div>
        <div v-if="detail.history.length === 0" class="tk-muted">
          Sin registro detallado (ticket anterior al registro).
        </div>
        <ol class="tk-story">
          <li
            v-for="e in detail.history"
            :key="e.id"
            :class="{ 'tk-story--alert': suspicionOf(e.type, e.data) }"
          >
            <span class="tk-when">{{ fmtTime(e.occurredAt) }}</span>
            <span class="tk-type" :class="`tk-type--${typeMeta(e.type).tone}`">
              <i class="pi" :class="typeMeta(e.type).icon"></i> {{ typeMeta(e.type).label }}
            </span>
            <span>{{ e.userName ?? '—' }}</span>
            <span class="tk-story__text">
              <b v-if="suspicionOf(e.type, e.data)" class="tk-alert"
                >⚠ {{ suspicionOf(e.type, e.data) }}</b
              >
              {{ describeEvent(e.type, e.data) }}
            </span>
          </li>
        </ol>
      </div>
      <div v-else class="tk-muted">Cargando…</div>
    </Dialog>
  </div>
</template>

<style scoped>
.tk {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tk-bar {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tk-presets,
.tk-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.tk-preset {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.tk-preset--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.tk-range {
  width: 16rem;
}
.tk-f {
  width: 12rem;
}
.tk-f--wide {
  width: 18rem;
}
.tk-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.tk-summary {
  font-size: 14px;
  color: var(--pos-text-2);
}
.tk-summary__period {
  margin-left: 10px;
  color: var(--pos-text-3);
  font-size: 12px;
}
.tk-when {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.tk-link {
  background: none;
  padding: 0;
  color: var(--pos-green-dark);
  font-weight: 700;
  text-decoration: underline dotted;
  text-align: left;
}
.tk-muted {
  color: var(--pos-text-3);
  font-size: 12px;
}
.tk-method {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.tk-method--efectivo {
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.tk-method--tarjeta {
  background: #e8f1fd;
  color: #1d4ed8;
}
.tk-method--a_cuenta {
  background: #fdeef2;
  color: #c2185b;
}
.tk-manual {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  white-space: nowrap;
}
.tk-neg {
  color: var(--pos-danger);
}
.tk-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tk-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.tk-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #f8fafc;
  border-radius: 10px;
  padding: 8px 10px;
}
.tk-grid span {
  font-size: 11px;
  font-weight: 800;
  color: var(--pos-text-3);
  text-transform: uppercase;
}
.tk-grid small {
  font-size: 12px;
  color: var(--pos-text-2);
}
.tk-title {
  font-size: 14px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-top: 6px;
}
.tk-lines {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tk-lines th {
  text-align: left;
  font-size: 11px;
  color: var(--pos-text-3);
  text-transform: uppercase;
  padding: 4px 6px;
  border-bottom: 1px solid var(--pos-border-subtle);
}
.tk-lines td {
  padding: 6px;
  border-bottom: 1px solid var(--pos-border-subtle);
  vertical-align: top;
}
.tk-lines .num {
  text-align: right;
  white-space: nowrap;
}
.tk-story {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.tk-story li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.tk-story--alert {
  background: #fff5f5;
  border-radius: 6px;
}
.tk-story__text {
  color: var(--pos-text-2);
}
.tk-alert {
  color: var(--pos-danger);
  margin-right: 4px;
}
.tk-type {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.tk-type--ok {
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.tk-type--info {
  background: #e8f1fd;
  color: #1d4ed8;
}
.tk-type--warn {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.tk-type--danger {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.tk-type--muted {
  background: #f1f5f9;
  color: var(--pos-text-2);
}
</style>
