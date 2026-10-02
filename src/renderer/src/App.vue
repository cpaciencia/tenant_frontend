<script setup lang="ts">
import { RouterView } from 'vue-router'
import CustomerDisplay from './views/CustomerDisplay.vue'
import { useGlobalScanner } from './composables/useGlobalScanner'
import { missingIpcChannels } from './utils/staleBridge'

// The Main process opens the customer-display window with a `#customer` hash.
// Same bundle, two roles: that window renders the customer display directly and
// stays out of the router; every other window runs the routed POS app.
const isCustomerDisplay = window.location.hash.includes('customer')

// A new UI on top of an old Main process (dev hot-reload) breaks features silently:
// say so loudly instead.
const staleMain = missingIpcChannels().length > 0

// Listen for the barcode reader app-wide (not in the customer-display window).
if (!isCustomerDisplay) useGlobalScanner()
</script>

<template>
  <CustomerDisplay v-if="isCustomerDisplay" />
  <template v-else>
    <div v-if="staleMain" class="stale-main" role="alert">
      <i class="pi pi-exclamation-triangle"></i>
      <div>
        <b>La aplicación se ha actualizado y hay que reiniciarla.</b>
        Ciérrala del todo y vuelve a abrirla (en desarrollo: para <code>npm run dev</code> con
        Ctrl+C y lánzalo otra vez). Hasta entonces algunas funciones no guardarán bien.
      </div>
    </div>
    <RouterView />
  </template>
</template>

<style scoped>
.stale-main {
  position: fixed;
  z-index: 10000;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  max-width: 760px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--pos-danger, #c62828);
  color: #fff;
  font-size: 14px;
  line-height: 1.45;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.stale-main i {
  font-size: 22px;
  margin-top: 2px;
}
.stale-main code {
  background: rgba(255, 255, 255, 0.18);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
