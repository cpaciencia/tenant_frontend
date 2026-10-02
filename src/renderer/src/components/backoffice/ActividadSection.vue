<script setup lang="ts">
/**
 * "Actividad": everything the tills recorded, for admins (permission
 * `activity:read`; web + desktop). Built on the backend's analytics views:
 *
 * - Period + terminal filters, optional auto-refresh.
 * - Headline figures (sales, manual entries, things undone before paying…).
 * - Per-user table (click a name to filter the log), sales by hour and by day,
 *   cajas closed and failed logins in the period.
 * - The detailed log: quick filters by group, exact types, user and free text;
 *   each event described in plain words and expandable to all its data; CSV export.
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  getActivityEvents,
  getActivityFilters,
  getActivitySummary,
  type ActivityEvent,
  type ActivitySummary,
  type UserActivity
} from '../../services/admin'
import {
  ACTIVITY_GROUPS,
  EVENT_TYPES,
  csvCell,
  describeEvent,
  eurCents,
  eventAmountCents,
  suspicionOf,
  typeMeta,
  typesOfGroup,
  type ActivityGroup
} from '../../utils/activityFormat'
import { addDays, localDate } from '../../../../shared/shifts'
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../utils/period'

// --- Period ------------------------------------------------------------------

const preset = ref<PeriodPreset>('7d')
const customRange = ref<(Date | null)[] | null>(null)
const PRESETS = PERIOD_PRESETS
const period = computed(() => resolvePeriod(preset.value, customRange.value))

const terminal = ref<string | null>(null)
const options = reactive({
  users: [] as string[],
  terminals: [] as string[],
  types: [] as string[]
})

// --- Summary -------------------------------------------------------------------

const summary = ref<ActivitySummary | null>(null)
const summaryLoading = ref(false)
const error = ref('')
const updatedAt = ref<Date | null>(null)

async function loadSummary(): Promise<void> {
  summaryLoading.value = true
  try {
    summary.value = await getActivitySummary({ ...period.value, terminal: terminal.value })
    updatedAt.value = new Date()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la actividad'
  } finally {
    summaryLoading.value = false
  }
}

const totals = computed(() => summary.value?.totals)
const maxHour = computed(() =>
  Math.max(1, ...(summary.value?.byHour ?? []).map((h) => h.salesCents))
)
const maxDay = computed(() => Math.max(1, ...(summary.value?.byDay ?? []).map((d) => d.salesCents)))
/** 08–23 always shown, plus any other hour with sales. */
const hourBuckets = computed(() => {
  const byHour = new Map((summary.value?.byHour ?? []).map((h) => [h.hour, h]))
  const hours = new Set<number>([...Array.from({ length: 16 }, (_, i) => i + 8), ...byHour.keys()])
  return [...hours]
    .sort((a, b) => a - b)
    .map((hour) => byHour.get(hour) ?? { hour, tickets: 0, salesCents: 0 })
})

// --- Event log -----------------------------------------------------------------

const events = ref<ActivityEvent[]>([])
const eventsTotal = ref(0)
const eventsLoading = ref(false)
const page = ref(0)
const PAGE_SIZE = 50
const logFilter = reactive({
  user: null as string | null,
  group: null as ActivityGroup | null,
  types: [] as string[],
  q: ''
})
const expanded = ref<Record<string, boolean>>({})

/**
 * The whole story of a ticket (every event sharing its draftId: lines added and
 * removed, payment opened/cancelled, parked, paid or emptied), loaded when an
 * event of it is expanded.
 */
const histories = reactive<Record<string, ActivityEvent[] | 'loading'>>({})
async function loadHistory(draftId: string, around: string): Promise<void> {
  if (histories[draftId]) return
  histories[draftId] = 'loading'
  const day = localDate(new Date(around))
  try {
    const result = await getActivityEvents({
      from: addDays(day, -2),
      to: addDays(day, 2),
      q: draftId,
      size: 300
    })
    histories[draftId] = [...result.items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  } catch {
    histories[draftId] = []
  }
}
function onRowExpand(e: { data: ActivityEvent }): void {
  const draftId = e.data.data.draftId
  if (typeof draftId === 'string') void loadHistory(draftId, e.data.occurredAt)
}
const draftOf = (e: ActivityEvent): string | null =>
  typeof e.data.draftId === 'string' ? e.data.draftId : null

/** Exact types win over the quick group. */
const selectedTypes = computed(() =>
  logFilter.types.length ? logFilter.types : logFilter.group ? typesOfGroup(logFilter.group) : []
)
/** Every known type plus any other found in the log, by label. */
const typeOptions = computed(() =>
  [...new Set([...Object.keys(EVENT_TYPES), ...options.types])]
    .map((t) => ({ value: t, label: typeMeta(t).label }))
    .sort((a, b) => a.label.localeCompare(b.label))
)

function eventQuery(pageIndex: number, size = PAGE_SIZE): Parameters<typeof getActivityEvents>[0] {
  return {
    ...period.value,
    terminal: terminal.value,
    user: logFilter.user,
    types: selectedTypes.value,
    q: logFilter.q,
    page: pageIndex,
    size
  }
}

async function loadEvents(): Promise<void> {
  eventsLoading.value = true
  try {
    const result = await getActivityEvents(eventQuery(page.value))
    events.value = result.items
    eventsTotal.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el registro'
  } finally {
    eventsLoading.value = false
  }
}

function onPage(e: { page: number }): void {
  page.value = e.page
  void loadEvents()
}

/** Filter the log by a user (from the per-user table) and scroll to it. */
function focusUser(user: UserActivity): void {
  logFilter.user = user.userName
  document.getElementById('activity-log')?.scrollIntoView({ behavior: 'smooth' })
}

function setGroup(group: ActivityGroup | null): void {
  logFilter.group = group
  logFilter.types = []
}

// --- Export ---------------------------------------------------------------------

const exporting = ref(false)
/** Every event matching the filters (in pages), as a semicolon CSV for Excel. */
async function exportCsv(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const rows: ActivityEvent[] = []
    for (let p = 0; p < 40; p++) {
      const result = await getActivityEvents(eventQuery(p, 500))
      rows.push(...result.items)
      if (rows.length >= result.total || result.items.length === 0) break
    }
    const header = [
      'Fecha y hora',
      'Usuario',
      'Terminal',
      'Acción',
      'Detalle',
      'Importe (€)',
      'Datos'
    ]
    const lines = rows.map((e) => {
      const amount = eventAmountCents(e.type, e.data)
      return [
        fmtDateTime(e.occurredAt),
        e.userName ?? '',
        e.terminalId,
        typeMeta(e.type).label,
        describeEvent(e.type, e.data),
        amount === null ? '' : (amount / 100).toFixed(2).replace('.', ','),
        JSON.stringify(e.data)
      ]
        .map(csvCell)
        .join(';')
    })
    // BOM so Excel opens the accents correctly.
    const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `actividad-${period.value.from}_${period.value.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo exportar'
  } finally {
    exporting.value = false
  }
}

// --- Formatting -------------------------------------------------------------------

function fmtDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
    : '—'
}
/** "1/10/26 08:02 – 15:47" (same day) or "1/10/26 08:02 – 2/10/26 00:15". */
function fmtSpan(first: string | null, last: string | null): string {
  if (!first || !last) return '—'
  const a = new Date(first)
  const b = new Date(last)
  const day = (d: Date): string => d.toLocaleDateString('es-ES', { dateStyle: 'short' })
  const time = (d: Date): string =>
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return day(a) === day(b)
    ? `${day(a)} ${time(a)} – ${time(b)}`
    : `${day(a)} ${time(a)} – ${day(b)} ${time(b)}`
}
function fmtTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '—'
}
function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric'
  })
}
const pct = (value: number, max: number): string => `${Math.max(2, (value / max) * 100)}%`
/** Pretty key/value list of an event's data (arrays/objects as JSON). */
function dataEntries(data: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(data).map(([key, value]) => ({
    key,
    value:
      typeof value === 'object' && value !== null ? JSON.stringify(value, null, 1) : String(value)
  }))
}

// --- Loading / refresh ------------------------------------------------------------

async function refreshAll(): Promise<void> {
  error.value = ''
  await Promise.all([loadSummary(), loadEvents()])
}

watch([period, terminal], () => {
  page.value = 0
  void refreshAll()
})
watch(
  () => [logFilter.user, selectedTypes.value.join(','), logFilter.q],
  () => {
    page.value = 0
    void loadEvents()
  }
)

const autoRefresh = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
watch(autoRefresh, (on) => {
  if (timer) clearInterval(timer)
  timer = on ? setInterval(refreshAll, 60_000) : null
})

onMounted(async () => {
  try {
    Object.assign(options, await getActivityFilters())
  } catch {
    /* filters are optional */
  }
  await refreshAll()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="act">
    <!-- Period & scope -->
    <div class="bo-card act-bar">
      <div class="act-presets">
        <button
          v-for="p in PRESETS"
          :key="p.id"
          class="act-preset"
          :class="{ 'act-preset--on': preset === p.id }"
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
        class="act-range"
      />
      <Select
        v-model="terminal"
        :options="options.terminals"
        placeholder="Todos los terminales"
        show-clear
        class="act-terminal"
      />
      <span class="act-spacer" />
      <label class="act-auto">
        <ToggleSwitch v-model="autoRefresh" /> Actualizar cada minuto
      </label>
      <span v-if="updatedAt" class="act-updated">{{ fmtTime(updatedAt.toISOString()) }}</span>
      <Button
        icon="pi pi-refresh"
        text
        :loading="summaryLoading || eventsLoading"
        aria-label="Actualizar"
        @click="refreshAll"
      />
    </div>
    <span v-if="error" class="bo-error act-error">{{ error }}</span>

    <!-- Headline figures -->
    <div v-if="totals" class="act-kpis">
      <div class="act-kpi" :class="totals.suspicious ? 'act-kpi--alert' : 'act-kpi--ok'">
        <span><i class="pi pi-exclamation-triangle"></i> A revisar</span>
        <b>{{ totals.suspicious }}</b>
        <small>borrados tras abrir el cobro, efectivo tecleado…</small>
      </div>
      <div class="act-kpi act-kpi--ok">
        <span><i class="pi pi-shopping-cart"></i> Ventas</span>
        <b class="pos-money">{{ eurCents(totals.salesCents) }}</b>
        <small>{{ totals.tickets }} tickets</small>
      </div>
      <div class="act-kpi act-kpi--warn">
        <span><i class="pi pi-bolt"></i> Metido a mano</span>
        <b>{{ totals.manualLines }}</b>
        <small class="pos-money">{{ eurCents(totals.manualCents) }}</small>
      </div>
      <div class="act-kpi act-kpi--danger">
        <span><i class="pi pi-minus-circle"></i> Quitado antes de cobrar</span>
        <b>{{ totals.linesRemoved }}</b>
        <small class="pos-money">{{ eurCents(totals.linesRemovedCents) }}</small>
      </div>
      <div class="act-kpi act-kpi--danger">
        <span><i class="pi pi-trash"></i> Tickets vaciados</span>
        <b>{{ totals.ticketsCleared }}</b>
        <small class="pos-money">{{ eurCents(totals.ticketsClearedCents) }}</small>
      </div>
      <div class="act-kpi act-kpi--danger">
        <span><i class="pi pi-times-circle"></i> Cobros cancelados</span>
        <b>{{ totals.paymentsCancelled }}</b>
      </div>
      <div class="act-kpi act-kpi--warn">
        <span><i class="pi pi-question-circle"></i> Códigos no encontrados</span>
        <b>{{ totals.scansNotFound }}</b>
      </div>
      <div class="act-kpi" :class="totals.failedLogins ? 'act-kpi--danger' : ''">
        <span><i class="pi pi-lock"></i> Logins fallidos</span>
        <b>{{ totals.failedLogins }}</b>
      </div>
      <div
        class="act-kpi"
        :class="
          totals.cashDifferenceCents < 0
            ? 'act-kpi--danger'
            : totals.cashDifferenceCents > 0
              ? 'act-kpi--warn'
              : 'act-kpi--ok'
        "
      >
        <span><i class="pi pi-calculator"></i> Descuadre en cierres</span>
        <b class="pos-money">{{ eurCents(totals.cashDifferenceCents) }}</b>
        <small>{{ summary?.cajas.length ?? 0 }} cierres</small>
      </div>
      <div class="act-kpi" :class="totals.pendingOpen ? 'act-kpi--warn' : ''">
        <span><i class="pi pi-inbox"></i> Sin identificar</span>
        <b>{{ totals.pendingOpen }}</b>
        <small>pendientes</small>
      </div>
    </div>

    <!-- Per user -->
    <div class="bo-card act-card">
      <div class="act-title">Por usuario <small>pulsa un nombre para ver solo lo suyo</small></div>
      <DataTable
        :value="summary?.users ?? []"
        :loading="summaryLoading"
        data-key="userName"
        sort-mode="single"
        scrollable
      >
        <template #empty><div class="act-empty">Sin actividad en el periodo.</div></template>
        <Column field="userName" header="Usuario" sortable frozen>
          <template #body="{ data }">
            <button class="act-user" @click="focusUser(data)">{{ data.userName }}</button>
          </template>
        </Column>
        <Column field="tickets" header="Tickets" sortable />
        <Column field="salesCents" header="Vendido" sortable>
          <template #body="{ data }"
            ><span class="pos-money">{{ eurCents(data.salesCents) }}</span></template
          >
        </Column>
        <Column field="avgTicketCents" header="Ticket medio" sortable>
          <template #body="{ data }"
            ><span class="pos-money">{{ eurCents(data.avgTicketCents) }}</span></template
          >
        </Column>
        <Column field="manualLines" header="A mano" sortable>
          <template #body="{ data }">
            <span :class="{ 'act-flag--warn': data.manualLines }">{{ data.manualLines }}</span>
            <small v-if="data.manualLines" class="act-sub pos-money">
              {{ eurCents(data.manualCents) }}</small
            >
          </template>
        </Column>
        <Column field="linesRemoved" header="Líneas quitadas" sortable>
          <template #body="{ data }">
            <span :class="{ 'act-flag--danger': data.linesRemoved + data.qtyDecreased }">{{
              data.linesRemoved + data.qtyDecreased
            }}</span>
            <small v-if="data.linesRemovedCents" class="act-sub pos-money">
              {{ eurCents(data.linesRemovedCents) }}</small
            >
          </template>
        </Column>
        <Column field="ticketsCleared" header="Tickets vaciados" sortable>
          <template #body="{ data }">
            <span :class="{ 'act-flag--danger': data.ticketsCleared }">{{
              data.ticketsCleared
            }}</span>
            <small v-if="data.ticketsClearedCents" class="act-sub pos-money">
              {{ eurCents(data.ticketsClearedCents) }}</small
            >
          </template>
        </Column>
        <Column field="paymentsCancelled" header="Cobros cancelados" sortable>
          <template #body="{ data }">
            <span :class="{ 'act-flag--danger': data.paymentsCancelled }">{{
              data.paymentsCancelled
            }}</span>
          </template>
        </Column>
        <Column field="suspicious" header="A revisar" sortable>
          <template #body="{ data }">
            <span v-if="data.suspicious" class="act-alert-count">⚠ {{ data.suspicious }}</span>
            <span v-else>0</span>
          </template>
        </Column>
        <Column field="scansNotFound" header="No encontrados" sortable />
        <Column field="logins" header="Entradas" sortable />
        <Column header="Actividad">
          <template #body="{ data }">
            <span class="act-span">{{ fmtSpan(data.firstSeen, data.lastSeen) }}</span>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- Sales by hour / by day -->
    <div class="act-cols">
      <div class="bo-card act-card">
        <div class="act-title">Ventas por hora</div>
        <div class="act-hours">
          <div
            v-for="h in hourBuckets"
            :key="h.hour"
            class="act-hour"
            :title="`${h.hour}:00 · ${h.tickets} tickets · ${eurCents(h.salesCents)}`"
          >
            <div class="act-hour__bar">
              <div
                class="act-hour__fill"
                :style="{ height: h.salesCents ? pct(h.salesCents, maxHour) : '0' }"
              ></div>
            </div>
            <span class="act-hour__label">{{ h.hour }}</span>
            <span class="act-hour__count">{{ h.tickets || '' }}</span>
          </div>
        </div>
      </div>
      <div class="bo-card act-card">
        <div class="act-title">Ventas por día</div>
        <div v-if="!summary?.byDay.length" class="act-empty">Sin ventas.</div>
        <div v-for="d in summary?.byDay ?? []" :key="d.date" class="act-day">
          <span class="act-day__label">{{ fmtDay(d.date) }}</span>
          <div class="act-day__bar">
            <div class="act-day__fill" :style="{ width: pct(d.salesCents, maxDay) }"></div>
          </div>
          <span class="act-day__value pos-money">{{ eurCents(d.salesCents) }}</span>
          <small class="act-day__meta"
            >{{ d.tickets }} t.<template v-if="d.manualLines">
              · {{ d.manualLines }} a mano</template
            ></small
          >
        </div>
      </div>
    </div>

    <!-- Cajas closed & failed logins -->
    <div class="act-cols">
      <div class="bo-card act-card">
        <div class="act-title">Cierres de caja del periodo</div>
        <DataTable :value="summary?.cajas ?? []" data-key="cashSessionId" size="small">
          <template #empty><div class="act-empty">Ningún cierre en el periodo.</div></template>
          <Column header="Z">
            <template #body="{ data }">{{
              data.zNumber != null ? `Z ${data.zNumber}` : '—'
            }}</template>
          </Column>
          <Column field="terminalId" header="Terminal" />
          <Column header="Turno">
            <template #body="{ data }"
              >{{ data.shiftName ?? '—' }} {{ data.businessDate ?? '' }}</template
            >
          </Column>
          <Column field="responsibleName" header="Responsable" />
          <Column header="Total">
            <template #body="{ data }"
              ><span class="pos-money">{{ eurCents(data.totalCents) }}</span></template
            >
          </Column>
          <Column header="Descuadre">
            <template #body="{ data }">
              <span
                class="pos-money"
                :class="
                  (data.differenceCents ?? 0) < 0
                    ? 'act-flag--danger'
                    : (data.differenceCents ?? 0) > 0
                      ? 'act-flag--warn'
                      : 'act-flag--ok'
                "
                >{{ eurCents(data.differenceCents ?? 0) }}</span
              >
            </template>
          </Column>
          <Column header="Fondo corregido">
            <template #body="{ data }">{{
              data.floatCorrections ? `${data.floatCorrections} vez/veces` : '—'
            }}</template>
          </Column>
        </DataTable>
      </div>
      <div class="bo-card act-card">
        <div class="act-title">Logins fallidos</div>
        <div v-if="!summary?.failedLogins.length" class="act-empty">Ninguno en el periodo.</div>
        <div v-for="(f, i) in summary?.failedLogins ?? []" :key="i" class="act-fail">
          <i class="pi pi-lock"></i>
          <span>«{{ f.username || '?' }}»</span>
          <small>{{ fmtDateTime(f.occurredAt) }} · {{ f.terminalId }}</small>
        </div>
      </div>
    </div>

    <!-- Detailed log -->
    <div id="activity-log" class="bo-card act-card">
      <div class="act-title">
        Registro detallado
        <small>{{ eventsTotal }} eventos</small>
      </div>
      <div class="act-groups">
        <button
          class="act-group"
          :class="{ 'act-group--on': !logFilter.group && !logFilter.types.length }"
          @click="setGroup(null)"
        >
          Todo
        </button>
        <button
          v-for="g in ACTIVITY_GROUPS"
          :key="g.id"
          class="act-group"
          :class="{ 'act-group--on': logFilter.group === g.id && !logFilter.types.length }"
          @click="setGroup(g.id)"
        >
          <i class="pi" :class="g.icon"></i> {{ g.label }}
        </button>
      </div>
      <div class="act-logbar">
        <Select
          v-model="logFilter.user"
          :options="options.users"
          placeholder="Todos los usuarios"
          show-clear
          filter
          class="act-logbar__user"
        />
        <MultiSelect
          v-model="logFilter.types"
          :options="typeOptions"
          option-label="label"
          option-value="value"
          placeholder="Tipos concretos…"
          display="chip"
          :max-selected-labels="3"
          filter
          class="act-logbar__types"
        />
        <InputText
          v-model.lazy="logFilter.q"
          placeholder="Buscar (producto, código, ticket…)"
          class="act-logbar__q"
        />
        <span class="act-spacer" />
        <Button
          label="Exportar CSV"
          icon="pi pi-download"
          outlined
          :loading="exporting"
          @click="exportCsv"
        />
      </div>

      <DataTable
        v-model:expanded-rows="expanded"
        :value="events"
        :loading="eventsLoading"
        data-key="id"
        lazy
        paginator
        :rows="PAGE_SIZE"
        :total-records="eventsTotal"
        :first="page * PAGE_SIZE"
        size="small"
        :row-class="(e: ActivityEvent) => (suspicionOf(e.type, e.data) ? 'act-row--alert' : '')"
        @page="onPage"
        @row-expand="onRowExpand"
      >
        <template #empty><div class="act-empty">No hay eventos con estos filtros.</div></template>
        <Column expander style="width: 3rem" />
        <Column header="Cuándo" style="width: 11rem">
          <template #body="{ data }"
            ><span class="act-when">{{ fmtDateTime(data.occurredAt) }}</span></template
          >
        </Column>
        <Column header="Usuario" style="width: 11rem">
          <template #body="{ data }">
            <button v-if="data.userName" class="act-user" @click="logFilter.user = data.userName">
              {{ data.userName }}
            </button>
            <span v-else class="act-muted">—</span>
          </template>
        </Column>
        <Column field="terminalId" header="Terminal" style="width: 6rem" />
        <Column header="Acción" style="width: 13rem">
          <template #body="{ data }">
            <span class="act-type" :class="`act-type--${typeMeta(data.type).tone}`">
              <i class="pi" :class="typeMeta(data.type).icon"></i> {{ typeMeta(data.type).label }}
            </span>
          </template>
        </Column>
        <Column header="Qué pasó">
          <template #body="{ data }">
            <span v-if="suspicionOf(data.type, data.data)" class="act-alert">
              <i class="pi pi-exclamation-triangle"></i> {{ suspicionOf(data.type, data.data) }}
            </span>
            {{ describeEvent(data.type, data.data) }}
          </template>
        </Column>
        <Column header="Importe" style="width: 8rem">
          <template #body="{ data }">
            <span
              v-if="eventAmountCents(data.type, data.data) !== null"
              class="pos-money"
              :class="(eventAmountCents(data.type, data.data) ?? 0) < 0 ? 'act-flag--danger' : ''"
              >{{ eurCents(eventAmountCents(data.type, data.data) ?? 0) }}</span
            >
          </template>
        </Column>
        <template #expansion="{ data }">
          <div class="act-detail">
            <div v-if="draftOf(data)" class="act-story">
              <div class="act-story__title">Historia completa de este ticket</div>
              <div v-if="histories[draftOf(data)!] === 'loading'" class="act-muted">Cargando…</div>
              <ol v-else class="act-story__list">
                <li
                  v-for="step in (histories[draftOf(data)!] as ActivityEvent[]) ?? []"
                  :key="step.id"
                  :class="{ 'act-story__step--here': step.id === data.id }"
                >
                  <span class="act-when">{{ fmtTime(step.occurredAt) }}</span>
                  <span class="act-type" :class="`act-type--${typeMeta(step.type).tone}`">
                    <i class="pi" :class="typeMeta(step.type).icon"></i>
                    {{ typeMeta(step.type).label }}
                  </span>
                  <span>{{ step.userName ?? '—' }}</span>
                  <span class="act-story__text">{{ describeEvent(step.type, step.data) }}</span>
                </li>
              </ol>
            </div>
            <div class="act-detail__meta">
              <span><b>Tipo:</b> {{ data.type }}</span>
              <span v-if="data.entityId"><b>Referencia:</b> {{ data.entityId }}</span>
              <span v-if="data.cashSessionId"><b>Caja:</b> {{ data.cashSessionId }}</span>
              <span v-if="data.userId"><b>Id usuario:</b> {{ data.userId }}</span>
            </div>
            <table class="act-detail__data">
              <tr v-for="row in dataEntries(data.data)" :key="row.key">
                <th>{{ row.key }}</th>
                <td>
                  <pre>{{ row.value }}</pre>
                </td>
              </tr>
            </table>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.act {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.act-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 18px;
}
.act-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.act-preset {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.act-preset--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.act-range {
  width: 16rem;
}
.act-terminal {
  width: 13rem;
}
.act-spacer {
  flex: 1;
}
.act-auto {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.act-updated {
  font-size: 12px;
  color: var(--pos-text-3);
}
.act-error {
  padding: 0 4px;
}
.act-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.act-kpi {
  background: #fff;
  border-radius: 12px;
  border: 1px solid var(--pos-border-subtle);
  border-left: 4px solid var(--pos-border-medium);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.act-kpi span {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
}
.act-kpi b {
  font-size: 22px;
  color: var(--pos-text);
}
.act-kpi small {
  font-size: 12px;
  color: var(--pos-text-2);
  font-weight: 600;
}
.act-kpi--ok {
  border-left-color: var(--pos-green);
}
.act-kpi--warn {
  border-left-color: var(--pos-warn);
}
.act-kpi--danger {
  border-left-color: var(--pos-danger);
}
.act-card {
  padding: 18px;
}
.act-title {
  font-size: 15px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-bottom: 12px;
}
.act-title small {
  font-size: 12px;
  font-weight: 600;
  color: var(--pos-text-3);
  margin-left: 8px;
}
.act-empty {
  color: var(--pos-text-3);
  font-weight: 600;
  font-size: 13px;
  padding: 10px 0;
}
.act-user {
  font-weight: 800;
  color: var(--pos-green-dark);
  text-decoration: underline dotted;
  background: none;
  padding: 0;
}
.act-sub {
  /* The amount goes under its count: "1" + "2,50 €" must never read as "12,50 €". */
  display: block;
  font-size: 11px;
  color: var(--pos-text-3);
}
.act-span {
  white-space: nowrap;
  font-size: 12px;
  color: var(--pos-text-2);
}
.act-muted {
  color: var(--pos-text-3);
}
.act-flag--ok {
  color: var(--pos-green-hover);
  font-weight: 800;
}
.act-flag--warn {
  color: var(--pos-warn);
  font-weight: 800;
}
.act-flag--danger {
  color: var(--pos-danger);
  font-weight: 800;
}
.act-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 1100px) {
  .act-cols {
    grid-template-columns: 1fr;
  }
}
.act-hours {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
}
.act-hour {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  height: 100%;
}
.act-hour__bar {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  background: #f4f7f9;
  border-radius: 6px;
  overflow: hidden;
}
.act-hour__fill {
  width: 100%;
  background: var(--pos-green);
  border-radius: 6px 6px 0 0;
}
.act-hour__label {
  font-size: 11px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.act-hour__count {
  font-size: 10px;
  color: var(--pos-text-3);
  min-height: 12px;
}
.act-day {
  display: grid;
  grid-template-columns: 6.5rem 1fr 6rem;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 10px;
  margin-bottom: 8px;
}
.act-day__label {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-2);
  text-transform: capitalize;
}
.act-day__bar {
  height: 10px;
  background: #f1f5f9;
  border-radius: 6px;
  overflow: hidden;
}
.act-day__fill {
  height: 100%;
  background: var(--pos-green);
  border-radius: 6px;
}
.act-day__value {
  font-weight: 800;
  text-align: right;
  font-size: 13px;
}
.act-day__meta {
  grid-column: 2 / 4;
  font-size: 11px;
  color: var(--pos-text-3);
}
.act-fail {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--pos-border-subtle);
  font-size: 13px;
}
.act-fail i {
  color: var(--pos-danger);
}
.act-fail span {
  font-weight: 800;
}
.act-fail small {
  margin-left: auto;
  color: var(--pos-text-3);
}
.act-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.act-group {
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  background: #f4f7f9;
  color: var(--pos-text-2);
}
.act-group--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.act-logbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}
.act-logbar__user {
  width: 13rem;
}
.act-logbar__types {
  width: 20rem;
}
.act-logbar__q {
  width: 18rem;
}
.act-when {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.act-type {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.act-type--ok {
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.act-type--info {
  background: #e8f1fd;
  color: #1d4ed8;
}
.act-type--warn {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.act-type--danger {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.act-type--muted {
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.act-kpi--alert {
  border-left-color: var(--pos-danger);
  background: var(--pos-danger-bg);
}
.act-alert {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pos-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}
.act-alert-count {
  color: var(--pos-danger);
  font-weight: 900;
}
:deep(.act-row--alert) > td {
  background: #fff5f5 !important;
}
.act-story {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pos-border-subtle);
  border-radius: 10px;
  background: #fff;
}
.act-story__title {
  font-size: 13px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-bottom: 6px;
}
.act-story__list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.act-story__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.act-story__step--here {
  font-weight: 800;
}
.act-story__text {
  color: var(--pos-text-2);
}
.act-detail {
  padding: 8px 12px;
  background: #fbfcfd;
  border-radius: 8px;
}
.act-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: var(--pos-text-2);
  margin-bottom: 8px;
}
.act-detail__data {
  border-collapse: collapse;
  font-size: 12px;
}
.act-detail__data th {
  text-align: left;
  padding: 3px 12px 3px 0;
  color: var(--pos-text-3);
  font-weight: 800;
  vertical-align: top;
}
.act-detail__data pre {
  margin: 0;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
