<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CartState } from '../../../shared/types'

const state = ref<CartState>({ lines: [], totalCents: 0 })
let unsubscribe: (() => void) | null = null

const euros = (cents: number): string => (cents / 100).toFixed(2) + ' €'

onMounted(() => {
  unsubscribe = window.api.customerDisplay.onState((next) => (state.value = next))
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <main class="flex min-h-screen flex-col bg-surface-900 p-10 text-surface-0">
    <h1 class="mb-8 text-4xl font-bold">Su compra</h1>

    <ul class="flex flex-1 flex-col gap-3 text-2xl">
      <li v-for="line in state.lines" :key="line.productId" class="flex justify-between">
        <span>{{ line.quantity }} × {{ line.name }}</span>
        <span>{{ euros(line.quantity * line.unitPriceCents) }}</span>
      </li>
      <li v-if="!state.lines.length" class="text-surface-400">Esperando productos…</li>
    </ul>

    <div class="mt-8 flex justify-between border-t border-surface-700 pt-6 text-5xl font-bold">
      <span>Total</span>
      <span>{{ euros(state.totalCents) }}</span>
    </div>
  </main>
</template>
