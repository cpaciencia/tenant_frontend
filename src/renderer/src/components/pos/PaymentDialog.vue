<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import ClientPicker from './ClientPicker.vue'
import { useClientsStore } from '../../stores/clients'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../../shared/types'
import TicketReceipt from './TicketReceipt.vue'

import MoneyInput from '../common/MoneyInput.vue'
const store = usePosStore()
const {
  payOpen,
  payDone,
  payMethod,
  cashGiven,
  mixedCashEur,
  fiadoClient,
  settleClientId,
  settleEur,
  settleAmount,
  internalAccountId,
  internalTakenBy,
  internalReason,
  internalAccounts,
  staffNames,
  internalAllowed,
  dueTotal,
  total,
  ticket,
  change,
  cashOk,
  isRefund,
  confirmEnabled,
  payResultLabel,
  payChange,
  paying,
  payError,
  lastTicketNumber,
  lastSale
} = storeToRefs(store)

// Business header for the receipt (per-terminal settings).
const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
onMounted(async () => {
  try {
    settings.value = await window.api.settings.get()
  } catch {
    /* keep defaults */
  }
})

const showReceipt = ref(false)
const receiptLines = computed(() =>
  ticket.value.map((l) => ({
    name: l.name,
    quantity: l.qty,
    unitPriceCents: Math.round(l.price * 100),
    lineCents: Math.round(l.price * 100) * l.qty
  }))
)
const receiptBusiness = computed(() => ({
  name: settings.value.businessName,
  address: settings.value.businessAddress,
  taxId: settings.value.businessTaxId,
  phone: settings.value.businessPhone
}))
const changeCents = computed(() => Math.max(0, Math.round(payChange.value * 100)))

function printReceipt(): void {
  window.print()
}

const methods = [
  { id: 'efectivo' as const, label: 'Efectivo', icon: 'pi-money-bill' },
  { id: 'tarjeta' as const, label: 'Tarjeta', icon: 'pi-credit-card' },
  { id: 'mixto' as const, label: 'Mixto', icon: 'pi-wallet' },
  { id: 'fiado' as const, label: 'A cuenta', icon: 'pi-book' },
  { id: 'interno' as const, label: 'Consumo interno', icon: 'pi-home' }
]
// On a refund only direct cash/card give-back make sense (no mixed/credit).
const visibleMethods = computed(() =>
  isRefund.value ? methods.filter((m) => m.id === 'efectivo' || m.id === 'tarjeta') : methods
)

/** Card part of a mixed payment (the rest of what is due after the cash entered). */
const mixedCard = computed(() => Math.max(0, dueTotal.value - (mixedCashEur.value || 0)))

// --- Collect a client's debt with this purchase ---
const clients = useClientsStore()
const settleOpen = ref(false)
const canSettle = computed(
  () => !isRefund.value && payMethod.value !== 'fiado' && payMethod.value !== 'interno'
)
const settleBalance = computed(() => (clients.get(settleClientId.value)?.balanceCents ?? 0) / 100)
// Picking a client proposes the whole debt.
watch(settleClientId, (id) => {
  settleEur.value = id ? settleBalance.value : null
})
function toggleSettle(): void {
  settleOpen.value = !settleOpen.value
  if (!settleOpen.value) {
    settleClientId.value = null
    settleEur.value = null
  }
}
watch(payOpen, (open) => {
  if (open) settleOpen.value = false
})

const cashOptions = [
  { label: 'Exacto', value: -1 },
  { label: '5 €', value: 5 },
  { label: '10 €', value: 10 },
  { label: '20 €', value: 20 },
  { label: '50 €', value: 50 },
  { label: '100 €', value: 100 }
]

const showSuccessChange = computed(() => payChange.value > 0)
</script>

<template>
  <div v-if="payOpen" class="pay-overlay">
    <div class="pay-card">
      <!-- Success -->
      <div v-if="payDone" class="pay-done">
        <div class="pay-done__check"><i class="pi pi-check"></i></div>
        <div class="pay-done__title">
          {{
            isRefund
              ? 'Devolución realizada'
              : payMethod === 'interno'
                ? 'Consumo interno registrado'
                : 'Cobro realizado'
          }}
        </div>
        <div class="pay-done__label">{{ payResultLabel }}</div>
        <div v-if="lastTicketNumber" class="pay-done__ticket">
          <i class="pi pi-receipt"></i> {{ lastTicketNumber }}
        </div>
        <div v-if="showSuccessChange" class="pay-done__change">
          <div class="pay-done__change-label">CAMBIO A DEVOLVER</div>
          <div class="pay-done__change-val pos-money">{{ eur(payChange) }}</div>
        </div>
        <div class="pay-done__actions">
          <button
            v-if="lastSale"
            class="pay-done__btn pay-done__btn--ghost"
            @click="showReceipt = true"
          >
            <i class="pi pi-receipt"></i> VER TICKET
          </button>
          <button class="pay-done__btn" @click="store.newTicket()">
            <i class="pi pi-plus"></i> NUEVO TICKET
          </button>
        </div>
      </div>

      <!-- Form -->
      <template v-else>
        <div class="pay-head">
          <div>
            <div class="pay-head__label">
              {{
                isRefund
                  ? 'TOTAL A DEVOLVER'
                  : payMethod === 'interno'
                    ? 'VALOR (NO SE COBRA)'
                    : 'TOTAL A COBRAR'
              }}
            </div>
            <div class="pay-head__total pos-money">
              {{ isRefund ? eur(-total) : eur(dueTotal) }}
            </div>
            <div v-if="settleAmount > 0" class="pay-head__split">
              Ticket {{ eur(total) }} + cuenta {{ eur(settleAmount) }}
            </div>
          </div>
          <button class="pay-head__close" @click="store.closePay()">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div class="pay-methods">
          <button
            v-for="m in visibleMethods"
            :key="m.id"
            class="pay-method"
            :class="{ 'pay-method--active': payMethod === m.id }"
            @click="payMethod = m.id"
          >
            <i class="pi" :class="m.icon"></i> {{ m.label }}
          </button>
        </div>

        <div class="pay-body">
          <!-- Refund (negative total: hand back a deposit) -->
          <div v-if="isRefund" class="pay-refund">
            <div class="pay-refund__icon"><i class="pi pi-replay"></i></div>
            <div class="pay-refund__title">Devolver al cliente</div>
            <div class="pay-refund__amount pos-money">{{ eur(-total) }}</div>
            <div class="pay-refund__hint">
              {{
                payMethod === 'tarjeta'
                  ? 'Reintegro a la tarjeta del cliente.'
                  : 'Entrega el importe en efectivo del cajón.'
              }}
            </div>
          </div>

          <!-- Cash -->
          <div v-else-if="payMethod === 'efectivo'">
            <div class="pay-cash-grid">
              <button
                v-for="o in cashOptions"
                :key="o.label"
                class="pay-cash-opt"
                @click="store.pickCash(o.value)"
              >
                {{ o.label }}
              </button>
            </div>
            <div class="pay-cash-boxes">
              <div class="pay-box">
                <div class="pay-box__label">ENTREGADO</div>
                <div class="pay-box__val pos-money">{{ eur(cashGiven) }}</div>
              </div>
              <div
                class="pay-box"
                :style="cashOk ? { background: 'var(--pos-warn-bg)' } : { background: '#f8fafc' }"
              >
                <div class="pay-box__label">CAMBIO</div>
                <div
                  class="pay-box__val pos-money"
                  :style="{ color: cashOk ? 'var(--pos-warn)' : 'var(--pos-text-3)' }"
                >
                  {{ eur(change) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Card -->
          <div v-else-if="payMethod === 'tarjeta'" class="pay-card-wait">
            <div class="pay-card-wait__icon"><i class="pi pi-credit-card"></i></div>
            <div class="pay-card-wait__title">Inserte o acerque la tarjeta</div>
            <div class="pay-card-wait__hint">Esperando confirmación del datáfono…</div>
          </div>

          <!-- Mixto -->
          <div v-else-if="payMethod === 'mixto'" class="pay-mixed">
            <div class="pay-mixed__lead">Reparte el total entre efectivo y tarjeta:</div>
            <label class="pay-mixed__label">Pagado en efectivo</label>
            <MoneyInput v-model="mixedCashEur" :min="0" :max="dueTotal" fluid />
            <div class="pay-mixed__rest">
              Resto con tarjeta: <strong class="pos-money">{{ eur(mixedCard) }}</strong>
            </div>
          </div>

          <!-- A cuenta (credit) -->
          <div v-else-if="payMethod === 'fiado'">
            <div class="pay-fiado__lead">Anotar el importe a la cuenta de:</div>
            <ClientPicker v-model="fiadoClient" allow-create />
          </div>

          <!-- Internal consumption (not a sale) -->
          <div v-else-if="payMethod === 'interno'" class="pay-int">
            <div v-if="!internalAllowed" class="pay-int__warn">
              <i class="pi pi-exclamation-triangle"></i> Solo productos del catálogo: quita las
              líneas vendidas por precio para registrarlo como consumo interno.
            </div>
            <template v-else>
              <div class="pay-int__lead">
                No es una venta: no entra dinero. Se registra qué sale, para quién y quién se lo
                lleva.
              </div>
              <label class="pay-int__label">Cuenta interna</label>
              <div v-if="internalAccounts.length" class="pay-int__accounts">
                <button
                  v-for="a in internalAccounts"
                  :key="a.id"
                  class="pay-int__acc"
                  :class="{ 'pay-int__acc--on': internalAccountId === a.id }"
                  @click="internalAccountId = a.id"
                >
                  {{ a.name }}
                </button>
              </div>
              <div v-else class="pay-int__warn">
                No hay cuentas internas. El encargado las crea en Backoffice → Consumo interno.
              </div>
              <label class="pay-int__label" for="pay-int-who">Quién se lo lleva</label>
              <InputText
                id="pay-int-who"
                v-model="internalTakenBy"
                list="pay-int-staff"
                autocomplete="off"
                placeholder="Nombre de la persona (obligatorio)"
                fluid
              />
              <datalist id="pay-int-staff">
                <option v-for="n in staffNames" :key="n" :value="n" />
              </datalist>
              <label class="pay-int__label" for="pay-int-why"
                >Motivo <small>(opcional)</small></label
              >
              <InputText
                id="pay-int-why"
                v-model="internalReason"
                placeholder="p. ej. limpieza de baños"
                fluid
              />
            </template>
          </div>

          <!-- Collect a client's debt together with this purchase -->
          <div v-if="canSettle" class="pay-settle">
            <button class="pay-settle__toggle" @click="toggleSettle">
              <i class="pi" :class="settleOpen ? 'pi-minus-circle' : 'pi-plus-circle'"></i>
              Cobrar también una deuda de un cliente
            </button>
            <template v-if="settleOpen">
              <ClientPicker v-model="settleClientId" debtors-only />
              <div v-if="settleClientId" class="pay-settle__amount">
                <label>Importe de la deuda que paga ahora</label>
                <div class="pay-settle__row">
                  <MoneyInput v-model="settleEur" :min="0" :max="settleBalance" fluid />
                  <button class="pay-settle__all" @click="settleEur = settleBalance">
                    Todo ({{ eur(settleBalance) }})
                  </button>
                </div>
                <small v-if="(settleEur ?? 0) > settleBalance" class="pay-settle__err"
                  >No puede pagar más de lo que debe ({{ eur(settleBalance) }}).</small
                >
              </div>
            </template>
          </div>
        </div>

        <div v-if="payError" class="pay-error">
          <i class="pi pi-exclamation-triangle"></i> {{ payError }}
        </div>

        <div class="pay-foot">
          <button class="pay-cancel" :disabled="paying" @click="store.closePay()">Cancelar</button>
          <button
            class="pay-confirm"
            :disabled="!confirmEnabled || paying"
            @click="store.confirmPay()"
          >
            {{
              paying
                ? isRefund
                  ? 'DEVOLVIENDO…'
                  : 'COBRANDO…'
                : isRefund
                  ? 'CONFIRMAR DEVOLUCIÓN'
                  : payMethod === 'interno'
                    ? 'REGISTRAR CONSUMO INTERNO'
                    : 'CONFIRMAR COBRO'
            }}
          </button>
        </div>
      </template>
    </div>

    <!-- Printable receipt overlay -->
    <div v-if="showReceipt && lastSale" class="receipt-print">
      <div class="receipt-print__paper">
        <TicketReceipt
          :business="receiptBusiness"
          :ticket-number="lastSale.ticketNumber"
          :date-iso="lastSale.createdAt"
          :lines="receiptLines"
          :total-cents="lastSale.totalCents"
          :payment="lastSale.payment"
          :change-cents="changeCents"
        />
      </div>
      <div class="receipt-print__actions">
        <button class="pay-cancel" @click="showReceipt = false">Cerrar</button>
        <button class="pay-confirm" @click="printReceipt()">
          <i class="pi pi-print"></i> Imprimir
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pay-int {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pay-int__lead {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
}
.pay-int__label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 6px;
}
.pay-int__label small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.pay-int__accounts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.pay-int__acc {
  min-height: 50px;
  border-radius: 12px;
  border: 2px solid var(--pos-border-subtle);
  background: #fff;
  font-weight: 800;
}
.pay-int__acc--on {
  border-color: var(--pos-green);
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.pay-int__warn {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  font-weight: 700;
  font-size: 13px;
}
.pay-head__split {
  font-size: 13px;
  font-weight: 700;
  opacity: 0.85;
}
.pay-settle {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--pos-border-medium);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pay-settle__toggle {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  color: var(--pos-green-dark);
  background: transparent;
  padding: 6px 0;
}
.pay-settle__amount label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.pay-settle__row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.pay-settle__all {
  white-space: nowrap;
  padding: 0 14px;
  border-radius: 10px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font-weight: 800;
}
.pay-settle__err {
  color: var(--pos-danger);
  font-weight: 700;
}
.pay-mixed {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px;
}
.pay-mixed__lead {
  font-size: 14px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.pay-mixed__label {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  letter-spacing: 0.04em;
}
.pay-mixed__rest {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--pos-text-2);
}
.pay-refund {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 16px 0 10px;
}
.pay-refund__icon {
  width: 78px;
  height: 78px;
  border-radius: 18px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
}
.pay-refund__title {
  font-size: 15px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 16px;
  letter-spacing: 0.03em;
}
.pay-refund__amount {
  font-size: 40px;
  font-weight: 900;
  color: var(--pos-warn);
  margin-top: 4px;
}
.pay-refund__hint {
  font-size: 14px;
  color: var(--pos-text-3);
  margin-top: 8px;
}
.pay-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 18px 10px;
  padding: 10px 14px;
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
  border-radius: 10px;
  font-weight: 700;
  font-size: 13px;
}
.pay-done__ticket {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 800;
  font-size: 14px;
  color: var(--pos-green-dark);
  letter-spacing: 0.02em;
}
.pay-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  animation: pos-fadein 0.15s ease;
}
.pay-card {
  width: 560px;
  max-width: 92vw;
  max-height: 92vh;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--pos-shadow-modal);
}

/* Success */
.pay-done {
  padding: 54px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: pos-fadein 0.2s ease;
}
.pay-done__check {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: var(--pos-green-soft);
  color: var(--pos-green);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 46px;
  animation: pos-pop 0.4s ease;
}
.pay-done__title {
  font-size: 26px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-top: 24px;
}
.pay-done__label {
  font-size: 15px;
  color: var(--pos-text-2);
  margin-top: 8px;
}
.pay-done__change {
  margin-top: 22px;
  padding: 16px 30px;
  background: var(--pos-warn-bg);
  border-radius: 14px;
}
.pay-done__change-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-warn);
  letter-spacing: 0.04em;
}
.pay-done__change-val {
  font-size: 36px;
  color: var(--pos-warn);
}
.pay-done__btn {
  margin-top: 30px;
  width: 100%;
  height: 56px;
  background: var(--pos-green);
  color: #fff;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0.05em;
  border-radius: 12px;
  transition: background 0.12s ease;
}
.pay-done__btn:hover {
  background: var(--pos-green-hover);
}

/* Header */
.pay-head {
  padding: 22px 26px;
  background: var(--pos-green-dark);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pay-head__label {
  font-size: 12px;
  opacity: 0.7;
  font-weight: 700;
  letter-spacing: 0.05em;
}
.pay-head__total {
  font-size: 38px;
}
.pay-head__close {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 18px;
  transition: background 0.12s ease;
}
.pay-head__close:hover {
  background: rgba(255, 255, 255, 0.22);
}

/* Methods */
.pay-methods {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 16px 26px 0;
}
.pay-method {
  flex: 1 1 22%;
  min-width: 110px;
  height: 52px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  transition: all 0.12s ease;
}
.pay-method--active {
  background: var(--pos-green-dark);
  color: #fff;
}

/* Body */
.pay-body {
  padding: 20px 26px 8px;
  overflow-y: auto;
}
.pay-cash-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 9px;
}
.pay-cash-opt {
  height: 52px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 15px;
  background: #f8fafc;
  border: 1.5px solid var(--pos-border-medium);
  color: var(--pos-text);
  transition: all 0.12s ease;
}
.pay-cash-opt:hover {
  border-color: var(--pos-green);
}
.pay-cash-boxes {
  display: flex;
  gap: 14px;
  margin-top: 18px;
}
.pay-box {
  flex: 1;
  border-radius: 12px;
  padding: 14px 16px;
  background: #f8fafc;
}
.pay-box__label {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 700;
}
.pay-box__val {
  font-size: 26px;
  color: var(--pos-text);
}

.pay-card-wait {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 0 8px;
  color: var(--pos-text-2);
}
.pay-card-wait__icon {
  width: 78px;
  height: 78px;
  border-radius: 18px;
  background: #eef5ff;
  color: #2196f3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
}
.pay-card-wait__title {
  font-size: 17px;
  font-weight: 800;
  color: var(--pos-text);
  margin-top: 18px;
}
.pay-card-wait__hint {
  font-size: 14px;
  margin-top: 6px;
}

.pay-fiado__lead {
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-text-2);
  margin-bottom: 10px;
}

/* Footer */
.pay-foot {
  padding: 14px 26px 22px;
  display: flex;
  gap: 12px;
  border-top: 1px solid var(--pos-border-subtle);
  margin-top: 8px;
}
.pay-cancel {
  flex: 0 0 auto;
  padding: 0 26px;
  height: 58px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  font-weight: 800;
  font-size: 15px;
  border-radius: 12px;
  transition: background 0.12s ease;
}
.pay-cancel:hover {
  background: var(--pos-border-medium);
}
.pay-confirm {
  flex: 1;
  height: 58px;
  border-radius: 12px;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0.05em;
  background: var(--pos-green);
  color: #fff;
  box-shadow: var(--pos-shadow-cobrar);
  transition: background 0.12s ease;
}
.pay-confirm:disabled {
  background: var(--pos-text-disabled);
  box-shadow: none;
  cursor: not-allowed;
}
.pay-confirm:hover:not(:disabled) {
  background: var(--pos-green-hover);
}
.pay-done__actions {
  display: flex;
  gap: 10px;
  width: 100%;
}
.pay-done__btn--ghost {
  background: #f1f5f9;
  color: var(--pos-green-dark);
  box-shadow: none;
}
.receipt-print {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.receipt-print__paper {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
  max-height: 80vh;
  overflow-y: auto;
}
.receipt-print__actions {
  display: flex;
  gap: 12px;
}
.receipt-print__actions .pay-cancel,
.receipt-print__actions .pay-confirm {
  height: 48px;
  padding: 0 22px;
  flex: 0 0 auto;
}
</style>

<!-- Global (un-scoped) so printing shows ONLY the receipt paper. -->
<style>
@media print {
  body * {
    visibility: hidden !important;
  }
  .receipt-print__paper,
  .receipt-print__paper * {
    visibility: visible !important;
  }
  .receipt-print__paper {
    position: absolute;
    left: 0;
    top: 0;
    box-shadow: none;
    max-height: none;
  }
  .receipt-print__actions {
    display: none !important;
  }
}
</style>
