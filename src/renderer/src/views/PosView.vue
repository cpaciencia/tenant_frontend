<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { DEFAULT_SETTINGS, type CartState } from '../../../shared/types'
import { slotEnd, type ShiftDefinition } from '../../../shared/shifts'
import { cierreShiftLabel } from '../reports/cierreReport'
import { usePosStore } from '../stores/pos'
import { useAuthStore } from '../stores/auth'
import ProductGrid from '../components/pos/ProductGrid.vue'
import TicketPanel from '../components/pos/TicketPanel.vue'
import ActionsPanel from '../components/pos/ActionsPanel.vue'
import PaymentDialog from '../components/pos/PaymentDialog.vue'
import OpenCajaDialog from '../components/pos/OpenCajaDialog.vue'
import CloseCajaDialog from '../components/pos/CloseCajaDialog.vue'
import AcceptCajaDialog from '../components/pos/AcceptCajaDialog.vue'
import ManualEntryDialog from '../components/pos/ManualEntryDialog.vue'
import FreePriceDialog from '../components/pos/FreePriceDialog.vue'
import ParkedTicketsDialog from '../components/pos/ParkedTicketsDialog.vue'
import CashMovementsDialog from '../components/pos/CashMovementsDialog.vue'
import ClientsDialog from '../components/pos/ClientsDialog.vue'
import PendingItemsDialog from '../components/pos/PendingItemsDialog.vue'
import { eur } from '../data/catalog'
import logoUrl from '../assets/img/logo.png'

const store = usePosStore()
const auth = useAuthStore()
const {
  user,
  ticket,
  total,
  hasSession,
  currentSession,
  awaitingResponsible,
  manualEntry,
  freePriceOpen,
  pendingCount
} = storeToRefs(store)
/** List of lines sold by price that still need identifying. */
const showPending = ref(false)
/** Tickets set aside unpaid. */
const showParked = ref(false)
/** Supplier payments and cash in/out. */
const showMovements = ref(false)
const showClients = ref(false)
/** Movements opened because closing is blocked by missing supplier invoices. */
const movementsForClose = ref(false)

/** Payment whose invoice the Pendientes inbox asked to upload (opens Movimientos on it). */
const invoiceMovementId = ref<string | null>(null)

function openInvoiceFromInbox(movementId: string): void {
  showPending.value = false
  invoiceMovementId.value = movementId
  showMovements.value = true
}

/** Inbox = everything pending at the till: supplier invoices + products sold by price. */
const inboxCount = computed(() => pendingCount.value + store.invoicesPending)
const inboxTitle = computed(() => {
  const parts: string[] = []
  if (store.invoicesPending > 0)
    parts.push(`${store.invoicesPending} factura(s) de proveedor por subir`)
  if (pendingCount.value > 0) parts.push(`${pendingCount.value} producto(s) sin identificar`)
  return parts.length ? `Pendientes: ${parts.join(' · ')}` : 'No hay nada pendiente'
})

function closeMovements(): void {
  showMovements.value = false
  movementsForClose.value = false
  invoiceMovementId.value = null
  void store.reconcileInvoices()
}
const router = useRouter()

// The terminal's open caja belongs to the shift. On login, if the previous cierre
// left it without a responsible, the arriving user is asked to accept it — once
// per login ("Solo vender" dismisses it; the top-bar chip brings it back).
const showClose = ref(false)
const acceptDismissed = ref(false)
/** "Cerrar caja" on a caja without responsible: accept it first, then the arqueo. */
const acceptForClose = ref(false)
const showAccept = computed(
  () => awaitingResponsible.value && (acceptForClose.value || !acceptDismissed.value)
)

async function startClose(): Promise<void> {
  // Supplier invoices still missing: the caja can't be closed — go upload them.
  await store.refreshInvoicesPending()
  if (store.invoicesPending > 0) {
    movementsForClose.value = true
    showMovements.value = true
    return
  }
  if (awaitingResponsible.value) {
    acceptForClose.value = true
    return
  }
  showClose.value = true
}

function onAccepted(): void {
  acceptDismissed.value = true
  if (acceptForClose.value) {
    acceptForClose.value = false
    showClose.value = true
  }
}

function onAcceptSkipped(): void {
  acceptDismissed.value = true
  acceptForClose.value = false
}

const shifts = ref<ShiftDefinition[]>(DEFAULT_SETTINGS.shifts)
/** This terminal's id (ticket prefix), shown in the top bar. */
const terminalId = ref('')
const now = ref(new Date())
const clock = setInterval(() => (now.value = new Date()), 60_000)
onUnmounted(() => clearInterval(clock))

onMounted(async () => {
  await store.loadSession()
  void store.refreshPendingCount()
  void store.refreshParked()
  void store.refreshInvoicesPending()
  try {
    const settings = await window.api.settings.get()
    shifts.value = settings.shifts
    terminalId.value = settings.terminalId
  } catch {
    /* keep defaults */
  }
})

const shiftLabel = computed(() =>
  currentSession.value ? cierreShiftLabel(currentSession.value) : ''
)

/** The caja's shift is over and nobody closed it yet → nudge (closing needs a cash count). */
const shiftOverdue = computed(() => {
  const s = currentSession.value
  if (!s?.shiftId || !s.businessDate) return false
  const end = slotEnd(shifts.value, {
    shiftId: s.shiftId,
    shiftName: s.shiftName ?? '',
    businessDate: s.businessDate
  })
  return end !== null && end.getTime() <= now.value.getTime()
})

function onCajaClosed(): void {
  showClose.value = false
  // The next shift's caja is already open. Whoever just closed keeps selling into
  // it without being asked to take it over — the next person accepts it on login.
  acceptDismissed.value = true
}

// Identity for the top bar: the POS store is filled at login, but after a
// session is restored on boot only the auth store has it — fall back to that.
const displayName = computed(
  () => user.value?.name || auth.user?.fullName || auth.user?.username || ''
)
const displayRole = computed(() => user.value?.role || auth.user?.role || '')

// Mirror the cart to the customer-facing display whenever it changes. The store
// works in euros; the shared CartState is in cents.
const cartState = computed<CartState>(() => ({
  lines: ticket.value.map((l) => ({
    productId: l.id,
    name: l.name,
    quantity: l.qty,
    unitPriceCents: Math.round(l.price * 100)
  })),
  totalCents: Math.round(total.value * 100)
}))
watch(cartState, (state) => window.api.customerDisplay.update(state), {
  immediate: true,
  deep: true
})

function logout(): void {
  auth.logout()
  store.logout()
  router.push({ name: 'login' })
}
function goBackoffice(): void {
  router.push({ name: 'backoffice', params: { section: 'resumen' } })
}
</script>

<template>
  <div class="pos">
    <!-- Top bar -->
    <header class="pos__bar">
      <div class="pos__brand">
        <img :src="logoUrl" class="pos__logo" alt="" />
        <div>
          <div class="pos__brand-name">Parque Tropical</div>
          <div class="pos__brand-sub">TERMINAL {{ terminalId }}</div>
        </div>
      </div>

      <div v-if="currentSession" class="pos__caja-info" title="Caja abierta (turno)">
        <i class="pi pi-wallet"></i>
        <span>{{ shiftLabel }}</span>
      </div>
      <div
        v-if="currentSession"
        class="pos__caja-info"
        title="Fondo del cajón (se fija al abrir o aceptar la caja)"
      >
        <small>fondo</small> {{ eur(currentSession.openingFloatCents / 100) }}
      </div>
      <div
        v-if="currentSession?.responsibleName"
        class="pos__caja-info"
        title="Responsable de la caja"
      >
        <i class="pi pi-user"></i>
        <span>{{ currentSession.responsibleName }}</span>
      </div>
      <button
        v-else-if="currentSession"
        class="pos__caja-warn"
        title="Nadie se ha hecho responsable de esta caja"
        @click="acceptDismissed = false"
      >
        <i class="pi pi-inbox"></i> <span class="pos__label">Sin responsable</span>
      </button>
      <div v-if="shiftOverdue" class="pos__caja-warn" title="El horario del turno ya terminó">
        <i class="pi pi-clock"></i> <span class="pos__label">Turno terminado</span>
      </div>

      <div class="pos__spacer"></div>

      <button
        class="pos__pending"
        :class="{ 'pos__pending--blink': inboxCount > 0 }"
        :title="inboxTitle"
        @click="showPending = true"
      >
        <i class="pi pi-inbox"></i>
        <span v-if="inboxCount > 0" class="pos__pending-count">{{ inboxCount }}</span>
      </button>
      <button
        v-if="hasSession"
        class="pos__closecaja"
        title="Clientes a cuenta: ver lo que deben y cobrar deudas"
        @click="showClients = true"
      >
        <i class="pi pi-id-card"></i> <span class="pos__label">Clientes</span>
      </button>
      <button
        v-if="hasSession"
        class="pos__closecaja"
        title="Pagos a proveedores (con su factura), entradas y retiradas de dinero"
        :class="{ 'pos__pending--blink': store.invoicesPending > 0 }"
        @click="showMovements = true"
      >
        <i class="pi pi-arrow-right-arrow-left"></i> <span class="pos__label">Movimientos</span>
        <span
          v-if="store.invoicesPending > 0"
          class="pos__pending-count"
          :title="`${store.invoicesPending} factura(s) de proveedor sin subir`"
          >{{ store.invoicesPending }}</span
        >
      </button>
      <button
        v-if="hasSession"
        class="pos__closecaja"
        title="Hacer el arqueo y cerrar la caja"
        @click="startClose"
      >
        <i class="pi pi-calculator"></i> <span class="pos__label">Cerrar caja</span>
      </button>

      <button class="pos__backoffice" title="Backoffice" @click="goBackoffice">
        <i class="pi pi-sliders-h"></i> <span class="pos__label">Backoffice</span>
      </button>
      <div class="pos__user">
        <div class="pos__user-text">
          <div class="pos__user-name">{{ displayName }}</div>
          <div class="pos__user-role">{{ displayRole }}</div>
        </div>
        <button class="pos__logout" title="Cambiar cajera / cerrar sesión" @click="logout">
          <i class="pi pi-power-off"></i>
        </button>
      </div>
    </header>

    <!-- Sale grid -->
    <div class="pos__grid">
      <ProductGrid />
      <TicketPanel @open-parked="showParked = true" />
      <ActionsPanel />
    </div>

    <PaymentDialog />

    <!-- No open caja on this terminal (first run) → open one before selling. -->
    <OpenCajaDialog v-if="!hasSession" @logout="logout" />
    <!-- Caja left by the previous cierre without a responsible → offer to accept it. -->
    <AcceptCajaDialog
      v-else-if="showAccept && !showClose"
      :for-close="acceptForClose"
      @accepted="onAccepted"
      @skip="onAcceptSkipped"
    />
    <!-- A scanned code not in the catalog: sell it by price. -->
    <ManualEntryDialog v-if="manualEntry && hasSession" />
    <!-- "Producto" button: sell something without a barcode by its price. -->
    <FreePriceDialog v-if="freePriceOpen && hasSession" />
    <!-- Tickets set aside unpaid, to resume or discard. -->
    <ParkedTicketsDialog v-if="showParked" @close="showParked = false" />
    <!-- Supplier payments and cash in/out of the open caja. -->
    <ClientsDialog v-if="showClients" @close="showClients = false" />
    <CashMovementsDialog
      v-if="showMovements"
      :closing="movementsForClose"
      :invoice-movement-id="invoiceMovementId"
      @close="closeMovements"
    />
    <!-- Lines sold by price waiting to be identified (blinking badge). -->
    <PendingItemsDialog
      v-if="showPending"
      @close="showPending = false"
      @invoice="openInvoiceFromInbox"
    />
    <!-- Arqueo / cierre de caja. -->
    <CloseCajaDialog v-if="showClose" @closed="onCajaClosed" @cancel="showClose = false" />
  </div>
</template>

<style scoped>
.pos {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--pos-app-bg);
}
.pos__bar {
  height: 52px;
  flex: 0 0 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  background: #fff;
  border-bottom: 1px solid var(--pos-border-medium);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
/* Bar items keep one line; only the brand may shrink on narrow windows. */
.pos__bar > * {
  white-space: nowrap;
  flex-shrink: 0;
}
.pos__bar > .pos__brand {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
}
.pos__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pos__logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
  background: #fff;
  border: 1px solid var(--pos-border-subtle);
  border-radius: 50%;
  padding: 3px;
}
.pos__brand-name {
  font-weight: 900;
  font-size: 15px;
  color: var(--pos-green-dark);
  line-height: 1.1;
}
.pos__brand-sub {
  font-size: 11px;
  color: var(--pos-text-3);
  letter-spacing: 0.04em;
}
.pos__spacer {
  flex: 1;
}
/* Sale grid — layout B (the only layout): products fill the left across both
 * rows; ticket top-right (fluid), actions bottom-right (fixed height). */
.pos__grid {
  display: grid;
  gap: 14px;
  padding: 14px;
  flex: 1;
  min-height: 0;
  grid-template-columns: 1fr 460px;
  grid-template-rows: 1fr 270px;
  grid-template-areas: 'grid ticket' 'grid actions';
}
.pos__caja-info {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
}
.pos__caja-info small {
  font-weight: 600;
  color: var(--pos-green-hover);
}
.pos__caja-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 14px;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
}
.pos__pending {
  position: relative;
  width: 40px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #f1f5f9;
  color: var(--pos-text-3);
  font-size: 17px;
}
.pos__pending--blink {
  color: #fff;
  background: var(--pos-warn);
  animation: pos-pending-blink 1.1s ease-in-out infinite;
}
.pos__pending-count {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--pos-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
}
@keyframes pos-pending-blink {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.5);
  }
  50% {
    opacity: 0.55;
    box-shadow: 0 0 0 6px rgba(234, 88, 12, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pos__pending--blink {
    animation: none;
  }
}
.pos__closecaja {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 16px;
  background: #f1f5f9;
  color: var(--pos-green-dark);
  font-weight: 800;
  font-size: 14px;
  border-radius: 10px;
  transition: background 0.12s ease;
}
.pos__closecaja:hover {
  background: var(--pos-border-medium);
}
.pos__backoffice {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 16px;
  background: var(--pos-green-dark);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  border-radius: 10px;
  transition: background 0.12s ease;
}
.pos__backoffice:hover {
  background: #1c3a26;
}
.pos__user {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 6px 0 14px;
  background: #f1f5f9;
  border-radius: 10px;
}
.pos__user-text {
  text-align: right;
  line-height: 1.15;
  white-space: nowrap;
}
.pos__user-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text);
}
.pos__user-role {
  font-size: 10px;
  color: var(--pos-text-3);
  letter-spacing: 0.03em;
}
.pos__logout {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #fff;
  color: var(--pos-text-2);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}
.pos__logout:hover {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
/* Narrow windows: buttons keep their icon (and tooltip), labels go. */
@media (max-width: 1240px) {
  .pos__label,
  .pos__brand-name,
  .pos__brand-sub,
  .pos__user-role {
    display: none;
  }
}
</style>
