<script setup lang="ts">
import { RouterView } from 'vue-router'
import CustomerDisplay from './views/CustomerDisplay.vue'
import { useGlobalScanner } from './composables/useGlobalScanner'

// The Main process opens the customer-display window with a `#customer` hash.
// Same bundle, two roles: that window renders the customer display directly and
// stays out of the router; every other window runs the routed POS app.
const isCustomerDisplay = window.location.hash.includes('customer')

// Listen for the barcode reader app-wide (not in the customer-display window).
if (!isCustomerDisplay) useGlobalScanner()
</script>

<template>
  <CustomerDisplay v-if="isCustomerDisplay" />
  <RouterView v-else />
</template>
