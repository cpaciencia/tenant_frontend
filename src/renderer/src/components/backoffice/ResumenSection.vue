<script setup lang="ts">
/**
 * "Resumen": the owner's dashboard of a period — sales and how they were paid,
 * margin, when and what sells, who sells, and the things that need attention
 * (money owed, missing invoices, payments without invoice, internal consumption,
 * till differences, products to identify). Read-only, from the analytics layer.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getDashboard, type DashboardBucket, type DashboardSummary } from '../../services/dashboard'
import { eurCents } from '../../utils/activityFormat'
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../utils/period'

const preset = ref<PeriodPreset>('today')
const customRange = ref<(Date | null)[] | null>(null)
const period = computed(() => resolvePeriod(preset.value, customRange.value))
const data = ref<DashboardSummary | null>(null)
const loading = ref(false)
const error = ref('')

async function load(): Promise<void> {
  if (preset.value === 'custom' && !customRange.value?.[1]) return
  loading.value = true
  error.value = ''
  try {
    data.value = await getDashboard(period.value.from, period.value.to)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el resumen'
  } finally {
    loading.value = false
  }
}
watch(period, load)
onMounted(load)
// Live while open on "Hoy".
const timer = setInterval(() => {
  if (preset.value === 'today') void load()
}, 60_000)
onUnmounted(() => clearInterval(timer))

/** Hours of the day with no sales filled in (at least 08h–23h), so the chart reads as a day. */
const hours = computed<DashboardBucket[]>(() => {
  const list = data.value?.byHour ?? []
  const byLabel = new Map(list.map((b) => [b.label, b]))
  const nums = list.map((b) => parseInt(b.label, 10))
  const first = Math.min(8, ...nums)
  const last = Math.max(23, ...nums)
  const out: DashboardBucket[] = []
  for (let h = first; h <= last; h++) {
    const label = `${String(h).padStart(2, '0')}h`
    out.push(byLabel.get(label) ?? { label, cents: 0, count: 0 })
  }
  return out
})
/** Several days → per day; one day → per hour. */
const series = computed<DashboardBucket[]>(() =>
  (data.value?.byDay.length ?? 0) > 1 ? data.value!.byDay : hours.value
)

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)} %` : '—'
}
function maxOf(list: DashboardBucket[]): number {
  return Math.max(1, ...list.map((b) => b.cents))
}

const alerts = computed(() => {
  const a = data.value?.alerts
  if (!a) return []
  return [
    {
      show: a.cierresWithDifference > 0,
      tone: 'danger',
      icon: 'pi-calculator',
      text: `${a.cierresWithDifference} cierre(s) con descuadre (${eurCents(a.cierresDifferenceCents)})`
    },
    {
      show: a.supplierInvoicesMissing > 0,
      tone: 'danger',
      icon: 'pi-file',
      text: `${a.supplierInvoicesMissing} pago(s) a proveedor sin factura`
    },
    {
      show: a.paymentsWithoutInvoiceCents > 0,
      tone: 'warn',
      icon: 'pi-user',
      text: `Pagos sin factura: ${eurCents(a.paymentsWithoutInvoiceCents)}`
    },
    {
      show: a.internalConsumptionCostCents > 0,
      tone: 'warn',
      icon: 'pi-home',
      text: `Consumo interno a coste: ${eurCents(a.internalConsumptionCostCents)}`
    },
    {
      show: a.pendingItems > 0,
      tone: 'warn',
      icon: 'pi-inbox',
      text: `${a.pendingItems} producto(s) vendidos sin identificar`
    },
    {
      show: a.clientsOwing > 0,
      tone: 'info',
      icon: 'pi-id-card',
      text: `Clientes a cuenta deben ${eurCents(a.clientsOwedCents)} (${a.clientsOwing})`
    },
    {
      show: a.debtCollectedCents > 0,
      tone: 'ok',
      icon: 'pi-wallet',
      text: `Cobrado de cuentas: ${eurCents(a.debtCollectedCents)}`
    }
  ].filter((x) => x.show)
})
</script>

<template>
  <div class="rs">
    <div class="bo-card rs-bar">
      <div class="rs-presets">
        <button
          v-for="p in PERIOD_PRESETS"
          :key="p.id"
          class="rs-preset"
          :class="{ 'rs-preset--on': preset === p.id }"
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
      <span class="rs-spacer" />
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Actualizar" @click="load" />
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <template v-if="data">
      <div class="rs-kpis">
        <div class="bo-card rs-kpi rs-kpi--main">
          <span>Ventas</span>
          <b class="pos-money">{{ eurCents(data.totals.salesCents) }}</b>
          <small
            >{{ data.totals.tickets }} tickets · medio
            {{ eurCents(data.totals.avgTicketCents) }}</small
          >
        </div>
        <div class="bo-card rs-kpi">
          <span>Efectivo</span><b class="pos-money">{{ eurCents(data.totals.cashCents) }}</b>
          <small>{{ pct(data.totals.cashCents, data.totals.salesCents) }}</small>
        </div>
        <div class="bo-card rs-kpi">
          <span>Tarjeta</span><b class="pos-money">{{ eurCents(data.totals.cardCents) }}</b>
          <small>{{ pct(data.totals.cardCents, data.totals.salesCents) }}</small>
        </div>
        <div class="bo-card rs-kpi">
          <span>A cuenta</span><b class="pos-money">{{ eurCents(data.totals.creditCents) }}</b>
          <small>{{ pct(data.totals.creditCents, data.totals.salesCents) }}</small>
        </div>
        <div class="bo-card rs-kpi">
          <span>Margen bruto</span><b class="pos-money">{{ eurCents(data.totals.marginCents) }}</b>
          <small v-if="data.totals.linesWithoutCost"
            >{{ data.totals.linesWithoutCost }} línea(s) sin precio de compra</small
          >
          <small v-else>con precio de compra actual</small>
        </div>
      </div>

      <div v-if="alerts.length" class="rs-alerts">
        <div v-for="a in alerts" :key="a.text" class="rs-alert" :class="`rs-alert--${a.tone}`">
          <i class="pi" :class="a.icon"></i> {{ a.text }}
        </div>
      </div>

      <div class="rs-grid">
        <div class="bo-card rs-card">
          <div class="rs-title">
            {{ data.byDay.length > 1 ? 'Ventas por día' : 'Ventas por hora' }}
          </div>
          <div v-if="!data.totals.tickets" class="rs-empty">Sin ventas.</div>
          <div class="rs-bars">
            <div
              v-for="b in series"
              :key="b.label"
              class="rs-barcol"
              :title="`${b.label} · ${b.count} tickets · ${eurCents(b.cents)}`"
            >
              <div
                class="rs-barfill"
                :style="{
                  height: `${Math.round((b.cents / maxOf(series)) * 100)}%`
                }"
              ></div>
              <small>{{ b.label }}</small>
            </div>
          </div>
        </div>

        <div class="bo-card rs-card">
          <div class="rs-title">Por grupo contable</div>
          <div v-if="!data.byGroup.length" class="rs-empty">Sin ventas.</div>
          <div v-for="g in data.byGroup" :key="g.label" class="rs-row">
            <span>{{ g.label }}</span>
            <span class="rs-meter"
              ><span
                :style="{ width: `${Math.round((g.cents / maxOf(data.byGroup)) * 100)}%` }"
              ></span
            ></span>
            <b class="pos-money">{{ eurCents(g.cents) }}</b>
          </div>
        </div>

        <div class="bo-card rs-card">
          <div class="rs-title">Lo más vendido</div>
          <div v-if="!data.topProducts.length" class="rs-empty">Sin ventas.</div>
          <div v-for="(p, i) in data.topProducts" :key="p.name" class="rs-row">
            <span class="rs-rank">{{ i + 1 }}</span>
            <span class="rs-name">{{ p.name }}</span>
            <small>{{ p.units }} ud.</small>
            <b class="pos-money">{{ eurCents(p.cents) }}</b>
          </div>
        </div>

        <div class="bo-card rs-card">
          <div class="rs-title">Por vendedor</div>
          <div v-if="!data.bySeller.length" class="rs-empty">Sin ventas.</div>
          <div v-for="s in data.bySeller" :key="s.label" class="rs-row">
            <span class="rs-name">{{ s.label }}</span>
            <small>{{ s.count }} tickets</small>
            <b class="pos-money">{{ eurCents(s.cents) }}</b>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rs {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rs-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
}
.rs-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.rs-preset {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.rs-preset--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.rs-spacer {
  flex: 1;
}
.rs-kpis {
  display: grid;
  grid-template-columns: 1.4fr repeat(4, 1fr);
  gap: 12px;
}
.rs-kpi {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rs-kpi span {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  text-transform: uppercase;
}
.rs-kpi b {
  font-size: 22px;
}
.rs-kpi--main b {
  font-size: 30px;
  color: var(--pos-green-dark);
}
.rs-kpi small {
  color: var(--pos-text-3);
  font-weight: 600;
}
.rs-alerts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rs-alert {
  padding: 10px 14px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 14px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.rs-alert--danger {
  background: var(--pos-danger-bg-soft);
  color: var(--pos-danger);
}
.rs-alert--warn {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.rs-alert--info {
  background: #eef4ff;
  color: #2b4c9a;
}
.rs-alert--ok {
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.rs-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.rs-card {
  padding: 14px 18px;
}
.rs-title {
  font-weight: 900;
  margin-bottom: 10px;
}
.rs-empty {
  color: var(--pos-text-3);
  font-weight: 600;
}
.rs-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 180px;
}
.rs-barcol {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.rs-barfill {
  width: 100%;
  min-height: 2px;
  border-radius: 6px 6px 0 0;
  background: var(--pos-green);
}
.rs-barcol small {
  font-size: 10px;
  color: var(--pos-text-3);
  white-space: nowrap;
}
.rs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--pos-border-subtle);
  font-size: 14px;
}
.rs-row small {
  color: var(--pos-text-3);
}
.rs-name {
  flex: 1;
  min-width: 0;
}
.rs-rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font-weight: 900;
  font-size: 12px;
}
.rs-meter {
  flex: 1;
  height: 8px;
  border-radius: 99px;
  background: #eef2f5;
  overflow: hidden;
}
.rs-meter span {
  display: block;
  height: 100%;
  background: var(--pos-green);
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
@media (max-width: 1000px) {
  .rs-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
  .rs-grid {
    grid-template-columns: 1fr;
  }
}
</style>
