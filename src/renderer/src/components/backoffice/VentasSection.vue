<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  getCurrentTill,
  listCashSessions,
  listOpenCashSessions,
  type CashSessionView
} from '../../services/admin'
import { cierreShiftLabel, type ReportBusiness } from '../../reports/cierreReport'
import { exportCierrePdf, loadReportBusiness } from '../../reports/exportCierre'
import CierreReportFrame from '../cierre/CierreReportFrame.vue'

/**
 * Cajas (read-only, web + desktop). A caja belongs to a shift (turno) on a
 * terminal. Closing happens in the POS; this screen only reports.
 *
 * Left: the cajas OPEN right now, one per terminal, as they stand — figures are
 * computed live by the backend from the sales already synced, and the screen
 * refreshes itself. Right: the history of cierres. "Ver" opens the same document
 * the POS shows (an open caja shows its state "as of now"), exportable to PDF.
 */
const REFRESH_MS = 30_000

const openCajas = ref<CashSessionView[]>([])
const sessions = ref<CashSessionView[]>([])
/** Sales the backend has whose caja it doesn't know yet (till not fully synced). */
const unsyncedSales = ref(0)
const loading = ref(false)
const updatedAt = ref<Date | null>(null)
const error = ref('')
const detail = ref<CashSessionView | null>(null)
const business = ref<ReportBusiness>({ name: '' })
const exporting = ref(false)

const palette = ['#27ae60', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#ec407a', '#8d6e63']

function eur(cents: number | null): string {
  return ((cents ?? 0) / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
function fmtDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : '—'
}
function fmtTime(d: Date | null): string {
  return d ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''
}
const pct = (cents: number, total: number): string =>
  total > 0 ? `${Math.max(0, (cents / total) * 100)}%` : '0%'

const openTotalCents = computed(() => openCajas.value.reduce((a, c) => a + c.totalCents, 0))

const detailTitle = computed(() => {
  const d = detail.value
  if (!d) return 'Detalle'
  const head =
    d.status === 'open' ? 'Caja abierta' : `Cierre ${d.zNumber != null ? 'Z ' + d.zNumber : ''}`
  return `${head} · ${d.terminalId} · ${cierreShiftLabel(d)}`
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [open, all, till] = await Promise.all([
      listOpenCashSessions(),
      listCashSessions(),
      getCurrentTill()
    ])
    openCajas.value = open
    sessions.value = all.filter((s) => s.status === 'closed')
    const known = open.reduce((a, c) => a + c.salesCount, 0)
    unsyncedSales.value = Math.max(0, till.salesCount - known)
    updatedAt.value = new Date()
    // Keep an open detail in sync with the refreshed figures.
    if (detail.value?.status === 'open') {
      detail.value = open.find((c) => c.id === detail.value?.id) ?? detail.value
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la información de caja'
  } finally {
    loading.value = false
  }
}

async function savePdf(): Promise<void> {
  if (!detail.value || exporting.value) return
  exporting.value = true
  try {
    await exportCierrePdf(detail.value, business.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo exportar el PDF'
  } finally {
    exporting.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(async () => {
  business.value = await loadReportBusiness()
  await refresh()
  timer = setInterval(refresh, REFRESH_MS)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="za">
    <div class="za-cols">
      <!-- Cajas abiertas ahora (live) -->
      <div class="bo-card za-main">
        <div class="za-head">
          <div>
            <div class="za-head__label">CAJAS ABIERTAS AHORA</div>
            <div class="za-head__total pos-money">{{ eur(openTotalCents) }}</div>
            <div class="za-head__sub">
              {{ openCajas.length }} {{ openCajas.length === 1 ? 'caja' : 'cajas' }}
              <template v-if="updatedAt"> · actualizado {{ fmtTime(updatedAt) }}</template>
            </div>
          </div>
          <div class="za-head__actions">
            <span class="za-hint">Se actualiza solo · el cierre se hace en el TPV</span>
            <Button
              icon="pi pi-refresh"
              text
              :loading="loading"
              aria-label="Actualizar"
              @click="refresh"
            />
          </div>
        </div>
        <span v-if="error" class="bo-error">{{ error }}</span>
        <div v-if="unsyncedSales > 0" class="za-note">
          <i class="pi pi-info-circle"></i>
          {{ unsyncedSales }} ventas de una caja que el TPV aún no ha enviado. Aparecerá aquí en
          cuanto la abra, acepte o cierre.
        </div>

        <div v-if="openCajas.length === 0 && !loading" class="za-empty">
          No hay ninguna caja abierta.
        </div>

        <div v-for="caja in openCajas" :key="caja.id" class="za-caja">
          <div class="za-caja__head">
            <div>
              <div class="za-caja__title">
                <i class="pi pi-desktop"></i> {{ caja.terminalId }} · {{ cierreShiftLabel(caja) }}
              </div>
              <div class="za-caja__sub">
                Abierta {{ fmtDate(caja.openedAt) }} por {{ caja.cashierName }}
              </div>
            </div>
            <span v-if="caja.responsibleName" class="za-badge">
              <i class="pi pi-user"></i> {{ caja.responsibleName }}
            </span>
            <span v-else class="za-badge za-badge--warn">
              <i class="pi pi-inbox"></i> Sin responsable
            </span>
          </div>

          <div class="za-caja__kpis">
            <div class="za-kpi">
              <span>Vendido ({{ caja.salesCount }})</span>
              <b class="pos-money">{{ eur(caja.totalCents) }}</b>
            </div>
            <div class="za-kpi">
              <span>Efectivo en cajón</span>
              <b class="pos-money">{{ eur(caja.expectedCashCents) }}</b>
              <small
                >fondo {{ eur(caja.openingFloatCents) }} + {{ eur(caja.tenders.cashCents) }}</small
              >
            </div>
          </div>

          <div class="za-tenders">
            <div class="za-tender">
              <i class="pi pi-money-bill"></i>
              <span>Efectivo</span>
              <strong class="pos-money">{{ eur(caja.tenders.cashCents) }}</strong>
            </div>
            <div class="za-tender">
              <i class="pi pi-credit-card"></i>
              <span>Tarjeta</span>
              <strong class="pos-money">{{ eur(caja.tenders.cardCents) }}</strong>
            </div>
            <div class="za-tender za-tender--credit">
              <i class="pi pi-book"></i>
              <span>A cuenta ({{ caja.fiados.length }})</span>
              <strong class="pos-money">{{ eur(caja.tenders.creditCents) }}</strong>
            </div>
          </div>

          <div v-if="caja.breakdown.length" class="za-title">Por grupo contable</div>
          <div
            v-for="(b, i) in caja.breakdown"
            :key="b.accountingGroupId ?? '__none__'"
            class="za-bd"
          >
            <div class="za-bd__row">
              <span class="za-bd__name"
                ><span class="za-bd__code">{{ b.code }}</span> {{ b.name }}</span
              >
              <span class="pos-money za-bd__amount">{{ eur(b.totalCents) }}</span>
            </div>
            <div class="za-bd__bar">
              <div
                class="za-bd__fill"
                :style="{
                  width: pct(b.totalCents, caja.totalCents),
                  background: palette[i % palette.length]
                }"
              ></div>
            </div>
          </div>

          <div v-if="caja.sellers.length" class="za-sellers">
            <span v-for="v in caja.sellers" :key="v.userId ?? v.name" class="za-seller">
              {{ v.name }} · {{ v.salesCount }} · <b class="pos-money">{{ eur(v.totalCents) }}</b>
            </span>
          </div>

          <div class="za-caja__foot">
            <Button label="Ver detalle" icon="pi pi-eye" text size="small" @click="detail = caja" />
          </div>
        </div>
      </div>

      <!-- Cierres anteriores (uno por turno) -->
      <div class="bo-card za-hist">
        <div class="za-title">Cierres anteriores</div>
        <DataTable :value="sessions" :loading="loading" data-key="id" paginator :rows="8">
          <template #empty><div class="za-empty">Aún no hay cierres.</div></template>
          <Column header="Nº Z">
            <template #body="{ data }">{{
              data.zNumber != null ? `Z ${data.zNumber}` : '—'
            }}</template>
          </Column>
          <Column header="Terminal" field="terminalId" />
          <Column header="Turno">
            <template #body="{ data }">{{ cierreShiftLabel(data) }}</template>
          </Column>
          <Column header="Responsable">
            <template #body="{ data }">{{
              data.responsibleName || data.closedByName || data.cashierName
            }}</template>
          </Column>
          <Column header="Cerrada">
            <template #body="{ data }">{{ fmtDate(data.closedAt) }}</template>
          </Column>
          <Column header="Total">
            <template #body="{ data }"
              ><span class="pos-money">{{ eur(data.totalCents) }}</span></template
            >
          </Column>
          <Column header="Descuadre">
            <template #body="{ data }">
              <span
                class="pos-money aq-diff"
                :class="
                  data.differenceCents === 0
                    ? 'aq-diff--ok'
                    : (data.differenceCents ?? 0) > 0
                      ? 'aq-diff--over'
                      : 'aq-diff--short'
                "
                >{{ eur(data.differenceCents) }}</span
              >
            </template>
          </Column>
          <Column header="">
            <template #body="{ data }">
              <Button label="Ver" text size="small" @click="detail = data" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- Detalle del cierre: the same document the POS shows and exports. -->
    <Dialog
      :visible="detail !== null"
      modal
      :style="{ width: '60rem' }"
      :header="detailTitle"
      @update:visible="
        (v: boolean) => {
          if (!v) detail = null
        }
      "
    >
      <CierreReportFrame v-if="detail" :cierre="detail" :business="business" />
      <template #footer>
        <Button label="Guardar PDF" icon="pi pi-file-pdf" :loading="exporting" @click="savePdf" />
        <Button label="Cerrar" text @click="detail = null" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.za-cols {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 18px;
  align-items: start;
}
.za-main,
.za-hist {
  padding: 22px;
}
.za-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.za-head__label {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  letter-spacing: 0.05em;
}
.za-head__total {
  font-size: 30px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-top: 4px;
}
.za-head__sub {
  font-size: 13px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.za-note {
  margin-top: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--pos-warn);
  background: var(--pos-warn-bg);
  border-radius: 8px;
  padding: 8px 10px;
}
.za-caja {
  margin-top: 16px;
  border: 1px solid var(--pos-border-subtle);
  border-radius: 12px;
  padding: 14px 16px;
}
.za-caja__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.za-caja__title {
  font-size: 15px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.za-caja__sub {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 600;
  margin-top: 2px;
}
.za-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-green-dark);
  background: var(--pos-green-soft);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}
.za-badge--warn {
  color: var(--pos-warn);
  background: var(--pos-warn-bg);
}
.za-caja__kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 12px 0 10px;
}
.za-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.za-kpi span {
  font-size: 12px;
  font-weight: 700;
  color: var(--pos-text-3);
}
.za-kpi b {
  font-size: 20px;
  color: var(--pos-green-dark);
}
.za-kpi small {
  font-size: 11px;
  color: var(--pos-text-3);
}
.za-sellers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.za-seller {
  font-size: 12px;
  color: var(--pos-text-2);
  background: #f4f7f9;
  border-radius: 6px;
  padding: 3px 8px;
}
.za-caja__foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.za-head__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.za-hint {
  font-size: 12px;
  font-weight: 700;
  color: var(--pos-text-3);
  background: #f4f7f9;
  border-radius: 8px;
  padding: 6px 10px;
}
.za-title {
  margin: 20px 0 12px;
  font-size: 14px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.za-hist .za-title {
  margin-top: 0;
}
.za-empty {
  color: var(--pos-text-3);
  font-weight: 600;
  font-size: 13px;
  padding: 8px 0;
}
.za-tenders {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 6px;
}
.za-tender {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: #f4f7f9;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.za-tender i {
  color: var(--pos-green-hover);
}
.za-tender strong {
  font-size: 16px;
  color: var(--pos-green-dark);
}
.za-tender--credit {
  background: #fdeef2;
}
.za-tender--credit i {
  color: #ec407a;
}
.za-tender--credit strong {
  color: #c2185b;
}
.za-bd {
  margin-bottom: 14px;
}
.za-bd__row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: #475569;
  margin-bottom: 6px;
}
.za-bd__code {
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-right: 4px;
}
.za-bd__amount {
  font-weight: 800;
}
.za-bd__bar {
  height: 9px;
  background: #f1f5f9;
  border-radius: 6px;
  overflow: hidden;
}
.za-bd__fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.2s ease;
}
.aq-diff {
  font-weight: 800;
}
.aq-diff--ok {
  color: var(--pos-green-hover);
}
.aq-diff--over {
  color: var(--pos-warn);
}
.aq-diff--short {
  color: var(--pos-danger);
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
