<script setup lang="ts">
/**
 * Cash in/out of the drawer that is not a sale, in the open caja:
 * - "Pagar a proveedor": money out (supplier from the list or a new one, delivery
 *   note/invoice nº, note). Its invoice MUST end up on the server: upload a file
 *   here, show a QR to upload it from a phone, or "más tarde" — but the caja can't
 *   be closed while any is missing.
 * - "Pago sin factura": paying someone who gives no invoice (who + concept required).
 * - "Entrada de dinero": money put into the drawer (e.g. to pay a supplier).
 * - "Retirada de dinero": money taken out of the drawer.
 * All of them count in the arqueo, are sealed into the cierre and audited. What is
 * put in and not yet taken out is shown here and proposed again when closing.
 */
import { computed, onMounted, ref } from 'vue'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import MoneyInput from '../common/MoneyInput.vue'
import InvoiceUploadPanel from './InvoiceUploadPanel.vue'
import type {
  CashMovement,
  CashMovementKind,
  CashMovementsSummary,
  Supplier
} from '../../../../shared/types'

const props = defineProps<{ closing?: boolean; invoiceMovementId?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const store = usePosStore()

const KINDS: { id: CashMovementKind; label: string; icon: string; hint: string }[] = [
  {
    id: 'supplier_payment',
    label: 'Pagar a proveedor',
    icon: 'pi-truck',
    hint: 'Sale dinero del cajón para pagar a un proveedor. Después hay que subir su factura.'
  },
  {
    id: 'other_payment',
    label: 'Pago sin factura',
    icon: 'pi-user',
    hint: 'Pagas a alguien que no da factura (p. ej. un jardinero). Indica a quién y por qué.'
  },
  {
    id: 'cash_in',
    label: 'Entrada de dinero',
    icon: 'pi-arrow-down',
    hint: 'Metes dinero en el cajón (p. ej. para pagar a un proveedor).'
  },
  {
    id: 'cash_out',
    label: 'Retirada de dinero',
    icon: 'pi-arrow-up',
    hint: 'Sacas dinero del cajón (p. ej. el que se metió).'
  }
]
const KIND_LABEL: Record<CashMovementKind, string> = {
  supplier_payment: 'Pago a proveedor',
  other_payment: 'Pago sin factura',
  cash_in: 'Entrada de dinero',
  cash_out: 'Retirada de dinero'
}

const kind = ref<CashMovementKind>('supplier_payment')
const amountEur = ref<number | null>(null)
const supplier = ref('')
const document = ref('')
const note = ref('')
const summary = ref<CashMovementsSummary | null>(null)
const suppliers = ref<Supplier[]>([])
const saving = ref(false)
const error = ref('')
const saved = ref('')

const current = computed(() => KINDS.find((k) => k.id === kind.value)!)
const matchedSupplier = computed(() => {
  const name = supplier.value.trim().toLocaleLowerCase('es')
  return name ? suppliers.value.find((s) => s.name.toLocaleLowerCase('es') === name) : undefined
})
const isNewSupplier = computed(() => !!supplier.value.trim() && !matchedSupplier.value)

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

async function load(): Promise<void> {
  try {
    ;[summary.value, suppliers.value] = await Promise.all([
      window.api.cashMovements.current(),
      window.api.cashMovements.suppliers()
    ])
    if (kind.value === 'cash_out' && amountEur.value === null && summary.value) {
      amountEur.value = summary.value.cashInPendingCents / 100 || null
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los movimientos.'
  }
  void store.refreshInvoicesPending()
}

onMounted(async () => {
  await load()
  // Opened from the Pendientes inbox: go straight to that payment's invoice.
  const target = summary.value?.list.find((m) => m.id === props.invoiceMovementId)
  if (target?.invoiceStatus === 'pending') openInvoice(target)
  await store.reconcileInvoices()
  await load()
})

function pick(k: CashMovementKind): void {
  kind.value = k
  error.value = ''
  saved.value = ''
  amountEur.value =
    k === 'cash_out' && summary.value?.cashInPendingCents
      ? summary.value.cashInPendingCents / 100
      : null
}

async function save(): Promise<void> {
  if (saving.value) return
  error.value = ''
  saved.value = ''
  if (!amountEur.value || amountEur.value <= 0) {
    error.value = 'Indica el importe.'
    return
  }
  if (kind.value === 'other_payment' && (!supplier.value.trim() || !note.value.trim())) {
    error.value = 'Indica a quién se paga y el concepto.'
    return
  }
  if (kind.value === 'supplier_payment' && !supplier.value.trim()) {
    error.value = 'Indica el proveedor.'
    return
  }
  saving.value = true
  try {
    const isSupplier = kind.value === 'supplier_payment'
    const movement = await window.api.cashMovements.record({
      kind: kind.value,
      amountCents: Math.round(amountEur.value * 100),
      supplierId: isSupplier ? (matchedSupplier.value?.id ?? null) : null,
      supplier: isSupplier || kind.value === 'other_payment' ? supplier.value.trim() : null,
      document: document.value.trim() || null,
      note: note.value.trim() || null,
      actor: store.actor()
    })
    saved.value = `${KIND_LABEL[kind.value]}: ${eur(amountEur.value)} registrado.`
    amountEur.value = null
    supplier.value = ''
    document.value = ''
    note.value = ''
    await load()
    if (isSupplier) openInvoice(movement)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo registrar.'
  } finally {
    saving.value = false
  }
}

// ── Invoice of a supplier payment (InvoiceUploadPanel) ───────────────────────
const invoiceFor = ref<CashMovement | null>(null)

function openInvoice(m: CashMovement): void {
  invoiceFor.value = { ...m }
}

async function onInvoiceUploaded(): Promise<void> {
  saved.value = `Factura de ${invoiceFor.value?.supplier ?? 'proveedor'} guardada en el servidor.`
  invoiceFor.value = null
  await load()
}
</script>

<template>
  <div class="cm-overlay" @click.self="emit('close')">
    <div class="cm-card">
      <div class="cm-head">
        <div class="cm-title"><i class="pi pi-arrow-right-arrow-left"></i> Movimientos de caja</div>
        <button class="cm-close" aria-label="Cerrar" @click="emit('close')">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <!-- Invoice of a supplier payment -->
      <div v-if="invoiceFor" class="cm-body">
        <InvoiceUploadPanel
          :movement="invoiceFor"
          @uploaded="onInvoiceUploaded"
          @cancel="invoiceFor = null"
        />
      </div>

      <div v-else class="cm-body">
        <div v-if="summary && summary.invoicesPending > 0" class="cm-missing">
          <i class="pi pi-exclamation-triangle"></i>
          <span>
            <template v-if="props.closing">Para cerrar la caja, sube antes </template>
            <template v-else>Falta subir </template>
            la factura de {{ summary.invoicesPending }} pago(s) a proveedor (abajo, botón
            <b>Subir factura</b>).
          </span>
        </div>

        <div class="cm-kinds">
          <button
            v-for="k in KINDS"
            :key="k.id"
            class="cm-kind"
            :class="{ 'cm-kind--on': kind === k.id }"
            @click="pick(k.id)"
          >
            <i class="pi" :class="k.icon"></i> {{ k.label }}
          </button>
        </div>
        <div class="cm-hint">{{ current.hint }}</div>

        <div class="cm-form">
          <label class="cm-label" for="cm-amount">Importe</label>
          <MoneyInput id="cm-amount" v-model="amountEur" fluid @keydown.enter="save" />

          <template v-if="kind === 'supplier_payment'">
            <label class="cm-label" for="cm-supplier">Proveedor</label>
            <InputText
              id="cm-supplier"
              v-model="supplier"
              list="cm-suppliers"
              autocomplete="off"
              placeholder="Elige de la lista o escribe uno nuevo"
              fluid
            />
            <datalist id="cm-suppliers">
              <option v-for="s in suppliers" :key="s.id" :value="s.name" />
            </datalist>
            <small v-if="isNewSupplier" class="cm-new"
              ><i class="pi pi-plus-circle"></i> Proveedor nuevo: se añadirá a la lista.</small
            >
            <label class="cm-label" for="cm-doc"
              >Nº de albarán o factura <small>(opcional)</small></label
            >
            <InputText id="cm-doc" v-model="document" fluid />
          </template>

          <template v-if="kind === 'other_payment'">
            <label class="cm-label" for="cm-payee">A quién se paga</label>
            <InputText
              id="cm-payee"
              v-model="supplier"
              autocomplete="off"
              placeholder="p. ej. Juan (jardinero)"
              fluid
            />
          </template>

          <label class="cm-label" for="cm-note"
            >{{ kind === 'other_payment' ? 'Concepto' : 'Nota' }}
            <small v-if="kind !== 'other_payment'">(opcional)</small></label
          >
          <InputText id="cm-note" v-model="note" fluid @keydown.enter="save" />
        </div>

        <span v-if="error" class="cm-error"
          ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
        >
        <span v-if="saved" class="cm-saved"><i class="pi pi-check-circle"></i> {{ saved }}</span>

        <button class="cm-save" :disabled="saving" @click="save">
          {{ saving ? 'GUARDANDO…' : `REGISTRAR · ${current.label.toUpperCase()}` }}
        </button>

        <div v-if="summary" class="cm-summary">
          <div v-if="summary.cashInPendingCents > 0" class="cm-owed">
            <i class="pi pi-wallet"></i> Dinero metido pendiente de retirar:
            <b class="pos-money">{{ eur(summary.cashInPendingCents / 100) }}</b>
          </div>
          <div class="cm-list-title">En esta caja</div>
          <div v-if="summary.list.length === 0" class="cm-empty">Ningún movimiento todavía.</div>
          <div v-for="m in summary.list" :key="m.id" class="cm-row">
            <span class="cm-row__time">{{ fmtTime(m.createdAt) }}</span>
            <span class="cm-row__kind" :class="`cm-row__kind--${m.kind}`">{{
              KIND_LABEL[m.kind]
            }}</span>
            <span class="cm-row__who">
              {{ m.supplier ?? '' }}<template v-if="m.document"> · {{ m.document }}</template>
              <template v-if="m.note"> · {{ m.note }}</template>
              <small> ({{ m.userName }})</small>
            </span>
            <button
              v-if="m.invoiceStatus === 'pending'"
              class="cm-inv-missing"
              @click="openInvoice(m)"
            >
              <i class="pi pi-upload"></i> Subir factura
            </button>
            <span
              v-else-if="m.invoiceStatus === 'uploaded'"
              class="cm-inv-ok"
              :title="m.invoiceFileName ?? ''"
              ><i class="pi pi-file-check"></i> Factura</span
            >
            <b class="pos-money" :class="m.kind === 'cash_in' ? 'cm-in' : 'cm-out'">
              {{ m.kind === 'cash_in' ? '+' : '−' }}{{ eur(m.amountCents / 100) }}
            </b>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.cm-card {
  width: 620px;
  max-width: 94vw;
  max-height: 92vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: var(--pos-shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--pos-green-dark);
  color: #fff;
}
.cm-title {
  font-size: 18px;
  font-weight: 900;
  display: flex;
  gap: 8px;
  align-items: center;
}
.cm-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.cm-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cm-kinds {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.cm-kind {
  min-height: 54px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 900;
  background: #f4f7f9;
  color: var(--pos-text-2);
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.cm-kind--on {
  background: var(--pos-green-soft);
  border-color: var(--pos-green);
  color: var(--pos-green-dark);
}
.cm-hint {
  font-size: 13px;
  color: var(--pos-text-2);
}
.cm-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cm-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 4px;
}
.cm-label small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.cm-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.cm-saved {
  color: var(--pos-green-hover);
  font-weight: 800;
  font-size: 13px;
}
.cm-save {
  height: 54px;
  border-radius: 12px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 900;
  letter-spacing: 0.03em;
}
.cm-summary {
  border-top: 1px dashed var(--pos-border-medium);
  padding-top: 10px;
}
.cm-owed {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  font-weight: 800;
  font-size: 14px;
  margin-bottom: 10px;
}
.cm-list-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  margin-bottom: 4px;
}
.cm-empty {
  font-size: 13px;
  color: var(--pos-text-3);
}
.cm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--pos-border-subtle);
  font-size: 13px;
}
.cm-row__time {
  color: var(--pos-text-3);
  font-variant-numeric: tabular-nums;
}
.cm-row__kind {
  font-weight: 800;
  white-space: nowrap;
}
.cm-row__who {
  flex: 1;
  min-width: 0;
  color: var(--pos-text-2);
}
.cm-missing {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pos-danger-bg-soft);
  color: var(--pos-danger);
  font-weight: 800;
  font-size: 14px;
}
.cm-new {
  color: var(--pos-green-hover);
  font-weight: 700;
}
.cm-inv-missing {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--pos-danger);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  white-space: nowrap;
  animation: cm-blink 1.1s ease-in-out infinite;
}
.cm-inv-ok {
  color: var(--pos-green-hover);
  font-weight: 800;
  font-size: 12px;
  white-space: nowrap;
}
@keyframes cm-blink {
  50% {
    opacity: 0.55;
  }
}
.cm-in {
  color: var(--pos-green-hover);
}
.cm-out {
  color: var(--pos-danger);
}
</style>
