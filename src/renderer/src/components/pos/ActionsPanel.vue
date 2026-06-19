<script setup lang="ts">
import { usePosStore } from '../../stores/pos'

const store = usePosStore()

const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫']
const isDanger = (k: string): boolean => k === 'C' || k === '⌫'
</script>

<template>
  <section class="actions">
    <button class="cobrar" :disabled="store.isEmpty" @click="store.openPay()">
      <i class="pi pi-money-bill"></i> COBRAR
    </button>
    <div class="actions__numpad">
      <button
        v-for="k in keys"
        :key="k"
        class="key"
        :class="{ 'key--danger': isDanger(k) }"
        @click="store.keyTap(k)"
      >
        {{ k }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.actions {
  grid-area: actions;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.cobrar {
  flex: 0 0 auto;
  width: 100%;
  height: 58px;
  background: var(--pos-green);
  color: #fff;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.05em;
  border-radius: var(--pos-radius-tile);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 11px;
  box-shadow: var(--pos-shadow-cobrar);
  transition:
    background 0.12s ease,
    transform 0.12s ease;
}
.cobrar:hover:not(:disabled) {
  background: var(--pos-green-hover);
}
.cobrar:active:not(:disabled) {
  transform: scale(0.985);
}
.cobrar:disabled {
  background: var(--pos-text-disabled);
  box-shadow: none;
  cursor: not-allowed;
}
.actions__numpad {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
  gap: 7px;
  min-height: 0;
}
.key {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--pos-radius-control);
  font-size: 16px;
  font-weight: 900;
  min-height: 32px;
  background: #fff;
  color: var(--pos-text);
  border: 1.5px solid var(--pos-border-subtle);
  transition: all 0.12s ease;
}
.key:hover {
  border-color: var(--pos-border-medium);
  background: #f8fafc;
}
.key--danger {
  background: var(--pos-danger-bg-soft);
  color: var(--pos-danger);
}
.key--danger:hover {
  background: var(--pos-danger-bg);
}
</style>
