<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  listClosures,
  getCurrentTill,
  getClosure,
  type ClosureView,
  type CurrentTill,
  type ClosureDetail
} from '../../services/admin'
import type { ZClosure } from '../../../../shared/types'
import { useCan } from '../../composables/useCan'

/**
 * Cash-up screen. READS from the backend (works in web + desktop): the open till
 * (current) and the closure history, with a per-closure detail (breakdown + its
 * tickets). The CLOSE action stays local to the terminal (IPC) — only shown on the
 * desktop app, which is the source of truth for sealing the till.
 */
const { can } = useCan()

const canClose = typeof window.api?.zReport?.close === 'function'

const current = ref<CurrentTill>({
  totalCents: 0,
  salesCount: 0,
  tenders: { cashCents: 0, cardCents: 0, creditCents: 0 },
  breakdown: []
})
const closures = ref<ClosureView[]>([])
const loading = ref(false)
const error = ref('')
const closing = ref(false)
const lastClosed = ref<ZClosure | null>(null)

const detailOpen = ref(false)
const detail = ref<ClosureDetail | null>(null)
const detailLoading = ref(false)

const palette = ['#27ae60', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#ec407a', '#8d6e63']

function eur(cents: number): string {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}
const pct = (cents: number): string =>
  current.value.totalCents > 0 ? `${(cents / current.value.totalCents) * 100}%` : '0%'

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[current.value, closures.value] = await Promise.all([getCurrentTill(), listClosures()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la información de caja'
  } finally {
    loading.value = false
  }
}

async function closeZ(): Promise<void> {
  if (closing.value || current.value.salesCount === 0) return
  if (!confirm(`¿Cerrar la caja? Se sellarán las ventas pendientes del terminal.`)) return
  closing.value = true
  error.value = ''
  try {
    lastClosed.value = await window.api.zReport.close()
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cerrar la caja'
  } finally {
    closing.value = false
  }
}

async function openDetail(c: ClosureView): Promise<void> {
  detailOpen.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getClosure(c.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el detalle'
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="za">
    <div v-if="lastClosed" class="bo-card za-done">
      <i class="pi pi-check-circle"></i>
      <div>
        <div class="za-done__title">Cierre Z nº {{ lastClosed.zNumber }} realizado</div>
        <div class="za-done__sub">
          {{ fmtDate(lastClosed.closedAt) }} · {{ lastClosed.salesCount }} ventas ·
          {{ eur(lastClosed.totalCents) }} — se sincronizará al backend.
        </div>
      </div>
    </div>

    <div class="za-cols">
      <!-- Caja actual -->
      <div class="bo-card za-main">
        <div class="za-head">
          <div>
            <div class="za-head__label">CAJA ACTUAL (PENDIENTE DE CIERRE)</div>
            <div class="za-head__total pos-money">{{ eur(current.totalCents) }}</div>
            <div class="za-head__sub">{{ current.salesCount }} ventas</div>
          </div>
          <Button
            v-if="canClose && can('register:close')"
            :label="closing ? 'Cerrando…' : 'Cerrar caja (Z)'"
            icon="pi pi-file-check"
            :disabled="closing || current.salesCount === 0"
            @click="closeZ"
          />
        </div>
        <span v-if="error" class="bo-error">{{ error }}</span>

        <div class="za-title">Cobrado por método</div>
        <div class="za-tenders">
          <div class="za-tender">
            <i class="pi pi-money-bill"></i>
            <span>Efectivo</span>
            <strong class="pos-money">{{ eur(current.tenders.cashCents) }}</strong>
          </div>
          <div class="za-tender">
            <i class="pi pi-credit-card"></i>
            <span>Tarjeta</span>
            <strong class="pos-money">{{ eur(current.tenders.cardCents) }}</strong>
          </div>
          <div class="za-tender za-tender--credit">
            <i class="pi pi-book"></i>
            <span>A cuenta (fiado)</span>
            <strong class="pos-money">{{ eur(current.tenders.creditCents) }}</strong>
          </div>
        </div>

        <div class="za-title">Desglose por caja por categoría</div>
        <div v-if="current.breakdown.length === 0" class="za-empty">Sin ventas pendientes.</div>
        <div
          v-for="(b, i) in current.breakdown"
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
              :style="{ width: pct(b.totalCents), background: palette[i % palette.length] }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Cierres anteriores -->
      <div class="bo-card za-hist">
        <div class="za-title">Cierres anteriores</div>
        <DataTable :value="closures" :loading="loading" data-key="id" paginator :rows="8">
          <template #empty><div class="za-empty">Aún no hay cierres.</div></template>
          <Column header="Nº"
            ><template #body="{ data }">Z {{ data.zNumber }}</template></Column
          >
          <Column header="Fecha"
            ><template #body="{ data }">{{ fmtDate(data.closedAt) }}</template></Column
          >
          <Column header="Ventas"
            ><template #body="{ data }">{{ data.salesCount }}</template></Column
          >
          <Column header="Total"
            ><template #body="{ data }"
              ><span class="pos-money">{{ eur(data.totalCents) }}</span></template
            ></Column
          >
          <Column header="">
            <template #body="{ data }">
              <Button label="Ver" text size="small" @click="openDetail(data)" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- Detalle de cierre -->
    <Dialog
      v-model:visible="detailOpen"
      modal
      :style="{ width: '42rem' }"
      :header="detail ? `Cierre Z nº ${detail.closure.zNumber}` : 'Detalle del cierre'"
    >
      <div v-if="detailLoading" class="za-empty">Cargando…</div>
      <div v-else-if="detail">
        <div class="za-dhead">
          {{ fmtDate(detail.closure.closedAt) }} · {{ detail.closure.terminalId }} ·
          {{ detail.closure.salesCount }} ventas ·
          <strong class="pos-money">{{ eur(detail.closure.totalCents) }}</strong>
        </div>
        <div class="za-title">Cobrado por método</div>
        <div class="za-tenders">
          <div class="za-tender">
            <i class="pi pi-money-bill"></i><span>Efectivo</span>
            <strong class="pos-money">{{ eur(detail.tenders.cashCents) }}</strong>
          </div>
          <div class="za-tender">
            <i class="pi pi-credit-card"></i><span>Tarjeta</span>
            <strong class="pos-money">{{ eur(detail.tenders.cardCents) }}</strong>
          </div>
          <div class="za-tender za-tender--credit">
            <i class="pi pi-book"></i><span>A cuenta</span>
            <strong class="pos-money">{{ eur(detail.tenders.creditCents) }}</strong>
          </div>
        </div>
        <div class="za-title">Desglose por caja</div>
        <div v-for="b in detail.breakdown" :key="b.accountingGroupId ?? '__none__'" class="za-drow">
          <span
            ><span class="za-bd__code">{{ b.code }}</span> {{ b.name }}</span
          >
          <span class="pos-money">{{ eur(b.totalCents) }}</span>
        </div>
        <div class="za-title">Tickets ({{ detail.tickets.length }})</div>
        <DataTable :value="detail.tickets" data-key="id" paginator :rows="8" class="za-tickets">
          <Column field="ticketNumber" header="Ticket" />
          <Column header="Hora"
            ><template #body="{ data }">{{ fmtDate(data.createdAt) }}</template></Column
          >
          <Column header="Total"
            ><template #body="{ data }"
              ><span class="pos-money">{{ eur(data.totalCents) }}</span></template
            ></Column
          >
        </DataTable>
      </div>
      <template #footer><Button label="Cerrar" text @click="detailOpen = false" /></template>
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
.za-done {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 22px;
  margin-bottom: 16px;
  background: var(--pos-green-soft);
  border: 1px solid var(--pos-green);
}
.za-done i {
  font-size: 26px;
  color: var(--pos-green-hover);
}
.za-done__title {
  font-weight: 900;
  color: var(--pos-green-dark);
  font-size: 15px;
}
.za-done__sub {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
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
.za-dhead {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
  margin-bottom: 6px;
}
.za-drow {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: #475569;
  padding: 5px 0;
  border-bottom: 1px solid #f4f7f9;
}
.za-tickets {
  margin-top: 6px;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
