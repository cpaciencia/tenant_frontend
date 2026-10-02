<script setup lang="ts">
/**
 * "Clientes" at the till: the "a cuenta" clients with what each owes. Pick one to
 * see their account (this till's credit sales and payments + what they owe on
 * other tills) and collect (part of) the debt in cash or card — that money goes
 * into today's caja as "Cobros de cuentas", it is NOT a sale. New clients can be
 * added here too (also offline).
 */
import { computed, onMounted, ref } from 'vue'
import ClientPicker from './ClientPicker.vue'
import MoneyInput from '../common/MoneyInput.vue'
import { useClientsStore } from '../../stores/clients'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import type { AccountPayment, ClientAccount } from '../../../../shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()
const clients = useClientsStore()
const pos = usePosStore()

const selected = ref<string | null>(null)
const account = ref<ClientAccount | null>(null)
const amountEur = ref<number | null>(null)
const method = ref<'cash' | 'card'>('cash')
const note = ref('')
const saving = ref(false)
const error = ref('')
const done = ref<AccountPayment | null>(null)

const balance = computed(() => (account.value?.client.balanceCents ?? 0) / 100)

onMounted(() => void clients.refresh())

async function openAccount(id: string | null): Promise<void> {
  selected.value = id
  done.value = null
  error.value = ''
  if (!id) {
    account.value = null
    return
  }
  try {
    account.value = await window.api.clients.account(id)
    amountEur.value = balance.value > 0 ? balance.value : null
    method.value = 'cash'
    note.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la cuenta.'
  }
}

async function settle(): Promise<void> {
  if (!account.value || saving.value) return
  const cents = Math.round((amountEur.value ?? 0) * 100)
  if (cents <= 0) {
    error.value = 'Indica el importe.'
    return
  }
  if (cents > account.value.client.balanceCents) {
    error.value = `No puede pagar más de lo que debe (${eur(balance.value)}).`
    return
  }
  saving.value = true
  error.value = ''
  try {
    done.value = await window.api.clients.settle({
      clientId: account.value.client.id,
      cashCents: method.value === 'cash' ? cents : 0,
      cardCents: method.value === 'card' ? cents : 0,
      note: note.value.trim() || null,
      actor: pos.actor()
    })
    await clients.load()
    const id = account.value.client.id
    account.value = await window.api.clients.account(id)
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : 'No se pudo cobrar.'
  } finally {
    saving.value = false
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <div class="cl-overlay" @click.self="emit('close')">
    <div class="cl-card">
      <div class="cl-head">
        <div class="cl-title">
          <i class="pi pi-id-card"></i>
          {{ account ? account.client.name : 'Clientes a cuenta' }}
        </div>
        <button class="cl-close" aria-label="Cerrar" @click="emit('close')">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div v-if="!account" class="cl-body">
        <ClientPicker :model-value="selected" allow-create @update:model-value="openAccount" />
      </div>

      <div v-else class="cl-body">
        <button class="cl-back" @click="openAccount(null)">
          <i class="pi pi-arrow-left"></i> Todos los clientes
        </button>
        <div class="cl-balance" :class="{ 'cl-balance--zero': balance <= 0 }">
          <span>{{ balance > 0 ? 'DEBE' : 'SIN DEUDA' }}</span>
          <b class="pos-money">{{ eur(Math.max(0, balance)) }}</b>
          <small v-if="account.client.detail">{{ account.client.detail }}</small>
        </div>

        <!-- Collect -->
        <div v-if="balance > 0 && !done" class="cl-pay">
          <div class="cl-pay__title">Cobrar deuda</div>
          <label>Importe</label>
          <div class="cl-row">
            <MoneyInput v-model="amountEur" :min="0" :max="balance" fluid />
            <button class="cl-all" @click="amountEur = balance">Todo</button>
          </div>
          <div class="cl-methods">
            <button
              class="cl-method"
              :class="{ 'cl-method--on': method === 'cash' }"
              @click="method = 'cash'"
            >
              <i class="pi pi-money-bill"></i> Efectivo
            </button>
            <button
              class="cl-method"
              :class="{ 'cl-method--on': method === 'card' }"
              @click="method = 'card'"
            >
              <i class="pi pi-credit-card"></i> Tarjeta
            </button>
          </div>
          <label>Nota <small>(opcional)</small></label>
          <InputText v-model="note" fluid />
          <span v-if="error" class="cl-error"
            ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
          >
          <button class="cl-confirm" :disabled="saving" @click="settle">
            {{ saving ? 'COBRANDO…' : `COBRAR ${eur(amountEur ?? 0)}` }}
          </button>
          <small class="cl-hint"
            >Entra en la caja de hoy como «Cobros de cuentas». No cuenta como venta.</small
          >
        </div>

        <div v-if="done" class="cl-done">
          <i class="pi pi-check-circle"></i>
          Cobrados <b>{{ eur(done.totalCents / 100) }}</b> ({{
            done.cashCents ? 'efectivo' : 'tarjeta'
          }}) · {{ done.paymentNumber }}
        </div>

        <!-- Account -->
        <div class="cl-list-title">Movimientos en esta caja</div>
        <div v-if="account.otherTerminalsCents !== 0" class="cl-other">
          + {{ eur(account.otherTerminalsCents / 100) }} de otros puestos
        </div>
        <div v-if="account.movements.length === 0" class="cl-empty">Sin movimientos aquí.</div>
        <div v-for="m in account.movements" :key="m.id" class="cl-mov">
          <span class="cl-mov__when">{{ fmt(m.createdAt) }}</span>
          <span class="cl-mov__what">
            {{ m.kind === 'payment' ? 'Pago' : 'Compra a cuenta' }} · {{ m.reference }}
            <small v-if="m.userName">({{ m.userName }})</small>
          </span>
          <b class="pos-money" :class="m.kind === 'payment' ? 'cl-mov--pay' : 'cl-mov--debt'"
            >{{ m.kind === 'payment' ? '−' : '+' }}{{ eur(m.amountCents / 100) }}</b
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.cl-card {
  width: 600px;
  max-width: 94vw;
  max-height: 92vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: var(--pos-shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--pos-green-dark);
  color: #fff;
}
.cl-title {
  font-size: 18px;
  font-weight: 900;
  display: flex;
  gap: 8px;
  align-items: center;
}
.cl-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.cl-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cl-back {
  align-self: flex-start;
  background: transparent;
  color: var(--pos-green-dark);
  font-weight: 800;
}
.cl-balance {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--pos-danger-bg-soft);
  color: var(--pos-danger);
  font-weight: 900;
}
.cl-balance b {
  font-size: 28px;
}
.cl-balance small {
  color: var(--pos-text-2);
  font-weight: 700;
}
.cl-balance--zero {
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.cl-pay {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1.5px solid var(--pos-border-subtle);
  border-radius: 14px;
}
.cl-pay__title {
  font-weight: 900;
  font-size: 15px;
}
.cl-pay label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.cl-pay small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.cl-row {
  display: flex;
  gap: 8px;
}
.cl-all {
  padding: 0 16px;
  border-radius: 10px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font-weight: 800;
}
.cl-methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 4px 0;
}
.cl-method {
  height: 50px;
  border-radius: 12px;
  border: 2px solid transparent;
  background: #f4f7f9;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.cl-method--on {
  border-color: var(--pos-green);
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
}
.cl-confirm {
  height: 54px;
  border-radius: 12px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 900;
  margin-top: 6px;
}
.cl-hint {
  text-align: center;
}
.cl-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.cl-done {
  padding: 12px;
  border-radius: 12px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font-weight: 700;
}
.cl-list-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  margin-top: 6px;
}
.cl-other {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 700;
}
.cl-empty {
  font-size: 13px;
  color: var(--pos-text-3);
}
.cl-mov {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--pos-border-subtle);
  font-size: 13px;
}
.cl-mov__when {
  color: var(--pos-text-3);
  white-space: nowrap;
}
.cl-mov__what {
  flex: 1;
}
.cl-mov--pay {
  color: var(--pos-green-hover);
}
.cl-mov--debt {
  color: var(--pos-danger);
}
</style>
