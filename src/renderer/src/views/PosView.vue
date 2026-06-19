<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import type { CartState } from '../../../shared/types'
import { usePosStore } from '../stores/pos'
import { useAuthStore } from '../stores/auth'
import ProductGrid from '../components/pos/ProductGrid.vue'
import TicketPanel from '../components/pos/TicketPanel.vue'
import ActionsPanel from '../components/pos/ActionsPanel.vue'
import PaymentDialog from '../components/pos/PaymentDialog.vue'
import logoUrl from '../assets/img/logo.png'

const store = usePosStore()
const auth = useAuthStore()
const { user, ticket, total } = storeToRefs(store)
const router = useRouter()

// Identity for the top bar: the POS store is filled at login, but after a
// session is restored on boot only the auth store has it — fall back to that.
const displayName = computed(
  () => user.value?.name || auth.user?.fullName || auth.user?.username || ''
)
const displayRole = computed(() => user.value?.role || auth.user?.role || '')

// The terminal/till identifier shown in the top bar.
const cajaNumber = 'CAJA 01'

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
  router.push({ name: 'backoffice', params: { section: 'ventas' } })
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
          <div class="pos__brand-sub">{{ cajaNumber }} · MINI-MARKET</div>
        </div>
      </div>

      <div class="pos__caja"><i class="pi pi-desktop"></i> {{ cajaNumber }}</div>

      <div class="pos__spacer"></div>

      <button class="pos__backoffice" @click="goBackoffice">
        <i class="pi pi-sliders-h"></i> Backoffice
      </button>
      <div class="pos__user">
        <div class="pos__user-text">
          <div class="pos__user-name">{{ displayName }}</div>
          <div class="pos__user-role">{{ displayRole }}</div>
        </div>
        <button class="pos__logout" title="Cerrar sesión" @click="logout">
          <i class="pi pi-power-off"></i>
        </button>
      </div>
    </header>

    <!-- Sale grid -->
    <div class="pos__grid">
      <ProductGrid />
      <TicketPanel />
      <ActionsPanel />
    </div>

    <PaymentDialog />
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
  gap: 18px;
  padding: 0 18px;
  background: #fff;
  border-bottom: 1px solid var(--pos-border-medium);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
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
.pos__caja {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: 8px;
  height: 34px;
  padding: 0 14px;
  background: #f1f5f9;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-green-dark);
  letter-spacing: 0.03em;
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
  grid-template-columns: 1fr 392px;
  grid-template-rows: 1fr 290px;
  grid-template-areas: 'grid ticket' 'grid actions';
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
</style>
