<script setup lang="ts">
/**
 * Arqueo / "Cerrar caja". Shows the caja's takings (by method, by accounting group,
 * fiados) and the expected cash (float + cash sales). The cashier counts the
 * drawer and types the counted amount → the difference (descuadre); leaves the
 * float, and the rest goes in the envelope. On confirm the caja is sealed, the
 * next shift's caja opens with that float, and the cierre document is shown so it
 * can be checked and saved as PDF.
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import { cierreShiftLabel, type ReportBusiness } from '../../reports/cierreReport'
import { exportCierrePdf, loadReportBusiness } from '../../reports/exportCierre'
import CierreReportFrame from '../cierre/CierreReportFrame.vue'
import type { CloseSessionResult, SessionArqueo } from '../../../../shared/types'

import MoneyInput from '../common/MoneyInput.vue'
const emit = defineEmits<{ (e: 'closed'): void; (e: 'cancel'): void }>()

const store = usePosStore()
const { currentSession } = storeToRefs(store)

const arqueo = ref<SessionArqueo | null>(null)
const loading = ref(true)
const countedEur = ref<number | null>(null)
const floatEur = ref(0)
/** Money put in that is still to be taken out, taken out as part of the cierre (prefilled). */
const cashOutEur = ref<number | null>(null)
const closing = ref(false)
const error = ref('')
/** Set once the caja is sealed: the dialog switches to the cierre document. */
const result = ref<CloseSessionResult | null>(null)
const business = ref<ReportBusiness>({ name: '' })
const exporting = ref(false)
const exportMsg = ref('')
const shiftLabel = computed(() =>
  currentSession.value ? cierreShiftLabel(currentSession.value) : ''
)

onMounted(async () => {
  const sid = currentSession.value?.id
  if (!sid) {
    error.value = 'No hay caja abierta.'
    loading.value = false
    return
  }
  try {
    arqueo.value = await window.api.cashSession.arqueo(sid)
    cashOutEur.value = arqueo.value.movements.cashInPendingCents / 100 || null
    const settings = await window.api.settings.get()
    floatEur.value = settings.cashFloatCents / 100
    business.value = await loadReportBusiness()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el arqueo.'
  } finally {
    loading.value = false
  }
})

const cashOutNow = computed(() => Math.max(0, cashOutEur.value ?? 0))
const expectedEur = computed(() =>
  arqueo.value ? arqueo.value.expectedCashCents / 100 - cashOutNow.value : 0
)
const counted = computed(() => countedEur.value ?? 0)
const difference = computed(() => counted.value - expectedEur.value)
const toRemove = computed(() => Math.max(0, counted.value - (floatEur.value || 0)))
const hasCount = computed(() => countedEur.value !== null)

async function confirm(): Promise<void> {
  if (closing.value || !hasCount.value) return
  closing.value = true
  error.value = ''
  try {
    result.value = await store.closeCaja({
      countedCashCents: Math.round(counted.value * 100),
      closingFloatCents: Math.max(0, Math.round((floatEur.value || 0) * 100)),
      cashOutCents: Math.round(cashOutNow.value * 100)
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cerrar la caja.'
  } finally {
    closing.value = false
  }
}

async function savePdf(): Promise<void> {
  if (!result.value || exporting.value) return
  exporting.value = true
  exportMsg.value = ''
  try {
    const out = await exportCierrePdf(result.value.closed, business.value)
    exportMsg.value = out.saved ? `PDF guardado${out.path ? ` en ${out.path}` : ''}` : ''
  } catch (e) {
    exportMsg.value = e instanceof Error ? e.message : 'No se pudo guardar el PDF.'
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="cc-overlay">
    <!-- After the cierre: the document, ready to check and save as PDF. -->
    <div v-if="result" class="cc-card cc-card--wide">
      <div class="cc-head">
        <div class="cc-title">
          Caja cerrada · Z {{ result.closed.zNumber }}
          <small class="cc-head-sub">Abierta la caja {{ cierreShiftLabel(result.next) }}</small>
        </div>
      </div>
      <div class="cc-body">
        <CierreReportFrame :cierre="result.closed" :business="business" />
        <span v-if="exportMsg" class="cc-export-msg">{{ exportMsg }}</span>
      </div>
      <div class="cc-foot">
        <button class="cc-cancel" :disabled="exporting" @click="savePdf">
          <i class="pi pi-file-pdf"></i> {{ exporting ? 'GUARDANDO…' : 'GUARDAR PDF' }}
        </button>
        <button class="cc-confirm" @click="emit('closed')">TERMINAR</button>
      </div>
    </div>

    <div v-else class="cc-card">
      <div class="cc-head">
        <div class="cc-title">
          Cerrar caja · Arqueo
          <small class="cc-head-sub">{{ shiftLabel }}</small>
        </div>
        <button class="cc-close" @click="emit('cancel')"><i class="pi pi-times"></i></button>
      </div>

      <div v-if="store.parkedCount > 0" class="cc-parked">
        <i class="pi pi-exclamation-triangle"></i>
        Hay {{ store.parkedCount }} ticket(s) aparcado(s) sin cobrar. No cuentan en esta caja:
        cóbralos o descártalos antes de cerrar.
      </div>
      <div v-if="loading" class="cc-loading">Cargando…</div>
      <div v-else-if="arqueo" class="cc-body">
        <!-- Summary -->
        <div class="cc-grid">
          <div class="cc-cell">
            <span>Ventas</span><b>{{ arqueo.salesCount }}</b>
          </div>
          <div class="cc-cell">
            <span>Total</span><b class="pos-money">{{ eur(arqueo.totalCents / 100) }}</b>
          </div>
        </div>
        <div class="cc-methods">
          <div class="cc-m">
            <span>Efectivo</span><b class="pos-money">{{ eur(arqueo.tenders.cashCents / 100) }}</b>
          </div>
          <div class="cc-m">
            <span>Tarjeta</span><b class="pos-money">{{ eur(arqueo.tenders.cardCents / 100) }}</b>
          </div>
          <div v-if="arqueo.tenders.creditCents !== 0" class="cc-m">
            <span>A cuenta</span
            ><b class="pos-money">{{ eur(arqueo.tenders.creditCents / 100) }}</b>
          </div>
        </div>

        <div v-if="arqueo.breakdown.length" class="cc-list">
          <div class="cc-list-title">Por grupo contable</div>
          <div v-for="b in arqueo.breakdown" :key="b.accountingGroupId ?? b.code" class="cc-row">
            <span
              ><b>{{ b.code }}</b> {{ b.name }}</span
            ><b class="pos-money">{{ eur(b.totalCents / 100) }}</b>
          </div>
        </div>
        <div v-if="arqueo.fiados.length" class="cc-list">
          <div class="cc-list-title">Ventas a cuenta</div>
          <div v-for="f in arqueo.fiados" :key="f.saleId" class="cc-row">
            <span
              >{{ f.clientName }} <small>{{ f.ticketNumber }}</small></span
            ><b class="pos-money">{{ eur(f.amountCents / 100) }}</b>
          </div>
        </div>

        <!-- Cash reconciliation -->
        <div class="cc-recon">
          <div class="cc-row">
            <span>Fondo de apertura</span
            ><b class="pos-money">{{ eur(arqueo.openingFloatCents / 100) }}</b>
          </div>
          <div class="cc-row">
            <span>+ Ventas en efectivo</span
            ><b class="pos-money">{{ eur(arqueo.tenders.cashCents / 100) }}</b>
          </div>
          <div v-if="arqueo.movements.cashInCents" class="cc-row">
            <span>+ Entradas de dinero</span
            ><b class="pos-money">{{ eur(arqueo.movements.cashInCents / 100) }}</b>
          </div>
          <div v-if="arqueo.movements.supplierPaymentsCents" class="cc-row">
            <span>− Pagos a proveedores</span
            ><b class="pos-money">{{ eur(arqueo.movements.supplierPaymentsCents / 100) }}</b>
          </div>
          <div v-if="arqueo.movements.cashOutCents" class="cc-row">
            <span>− Retiradas de dinero</span
            ><b class="pos-money">{{ eur(arqueo.movements.cashOutCents / 100) }}</b>
          </div>
          <div v-if="cashOutNow" class="cc-row">
            <span>− Retirar ahora</span><b class="pos-money">{{ eur(cashOutNow) }}</b>
          </div>
          <div class="cc-row cc-row--strong">
            <span>Efectivo esperado</span><b class="pos-money">{{ eur(expectedEur) }}</b>
          </div>
        </div>

        <div v-if="arqueo.movements.cashInPendingCents" class="cc-cashout">
          <label class="cc-label" for="cc-cashout">
            Retirar ahora el dinero metido
            <small
              >(se cogieron {{ eur(arqueo.movements.cashInPendingCents / 100) }} sin
              devolver)</small
            >
          </label>
          <MoneyInput id="cc-cashout" v-model="cashOutEur" fluid />
        </div>

        <label class="cc-label" for="cc-counted">Efectivo contado</label>
        <MoneyInput
          id="cc-counted"
          v-model="countedEur"
          :min="0"
          placeholder="Cuenta el cajón…"
          fluid
        />

        <div
          v-if="hasCount"
          class="cc-diff"
          :class="
            difference === 0 ? 'cc-diff--ok' : difference > 0 ? 'cc-diff--over' : 'cc-diff--short'
          "
        >
          <span>{{ difference === 0 ? 'Cuadra' : difference > 0 ? 'Sobra' : 'Falta' }}</span>
          <b class="pos-money">{{ eur(Math.abs(difference)) }}</b>
        </div>

        <label class="cc-label" for="cc-float">Fondo a dejar</label>
        <MoneyInput id="cc-float" v-model="floatEur" :min="0" fluid />
        <div v-if="hasCount" class="cc-row cc-row--remove">
          <span>A retirar</span><b class="pos-money">{{ eur(toRemove) }}</b>
        </div>
      </div>

      <span v-if="error" class="cc-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <div class="cc-foot">
        <button class="cc-cancel" :disabled="closing" @click="emit('cancel')">Cancelar</button>
        <button class="cc-confirm" :disabled="!hasCount || closing" @click="confirm">
          {{ closing ? 'CERRANDO…' : 'CONFIRMAR CIERRE' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cc-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.cc-card {
  width: 440px;
  max-width: 94vw;
  max-height: 92vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 18px;
  box-shadow: var(--pos-shadow-modal);
  display: flex;
  flex-direction: column;
}
.cc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  background: var(--pos-green-dark);
  color: #fff;
}
.cc-title {
  font-size: 18px;
  font-weight: 900;
  display: flex;
  flex-direction: column;
}
.cc-head-sub {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
}
.cc-card--wide {
  width: 860px;
}
.cc-list {
  border-top: 1px dashed var(--pos-border-medium);
  padding-top: 8px;
}
.cc-list-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  margin-bottom: 2px;
}
.cc-list small {
  color: var(--pos-text-3);
  font-size: 11px;
}
.cc-export-msg {
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-green-hover);
}
.cc-close {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.cc-parked {
  margin: 12px 22px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  font-size: 13px;
  font-weight: 800;
}
.cc-loading {
  padding: 30px;
  text-align: center;
  color: var(--pos-text-3);
  font-weight: 700;
}
.cc-body {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cc-grid {
  display: flex;
  gap: 10px;
}
.cc-cell {
  flex: 1;
  background: #f8fafc;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
}
.cc-cell span {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 700;
}
.cc-cell b {
  font-size: 18px;
  color: var(--pos-text);
}
.cc-methods {
  display: flex;
  gap: 10px;
}
.cc-m {
  flex: 1;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-text-2);
  background: #fbfcfd;
  border: 1px solid var(--pos-border-subtle);
  border-radius: 8px;
  padding: 7px 10px;
}
.cc-cashout {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pos-warn-bg);
}
.cc-cashout small {
  font-weight: 600;
  color: var(--pos-warn);
}
.cc-recon {
  border-top: 1px dashed var(--pos-border-medium);
  padding-top: 10px;
}
.cc-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: var(--pos-text-2);
  padding: 3px 0;
}
.cc-row--strong {
  font-weight: 900;
  color: var(--pos-green-dark);
  font-size: 15px;
}
.cc-row--remove {
  font-weight: 800;
  color: var(--pos-text);
}
.cc-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 4px;
}
.cc-diff {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-radius: 10px;
  font-weight: 900;
  font-size: 16px;
}
.cc-diff--ok {
  background: var(--pos-green-soft);
  color: var(--pos-green-hover);
}
.cc-diff--over {
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
}
.cc-diff--short {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
.cc-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
  padding: 0 22px 8px;
}
.cc-foot {
  display: flex;
  gap: 12px;
  padding: 14px 22px 20px;
  border-top: 1px solid var(--pos-border-subtle);
}
.cc-cancel {
  flex: 0 0 auto;
  padding: 0 22px;
  height: 52px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  font-weight: 800;
  border-radius: 11px;
}
.cc-confirm {
  flex: 1;
  height: 52px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 900;
  letter-spacing: 0.04em;
  border-radius: 11px;
}
.cc-confirm:disabled {
  background: var(--pos-text-disabled);
  cursor: not-allowed;
}
</style>
