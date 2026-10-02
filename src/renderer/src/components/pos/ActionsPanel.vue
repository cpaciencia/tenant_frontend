<script setup lang="ts">
/**
 * "Producto" (no barcode) + COBRAR, and the quantity keypad (the number typed applies to
 * the next product tapped).
 */
import { usePosStore } from '../../stores/pos'

const store = usePosStore()

const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫']
const isDanger = (k: string): boolean => k === 'C' || k === '⌫'
</script>

<template>
  <section class="actions">
    <div class="actions__main">
      <button
        class="free-price"
        title="Vender por su precio un producto que no tiene código"
        @click="store.freePriceOpen = true"
      >
        <i class="pi pi-euro"></i>
        <span>Producto</span>
      </button>
      <button class="cobrar" :disabled="store.isEmpty" @click="store.openPay()">
        <i class="pi pi-money-bill"></i> COBRAR
      </button>
    </div>
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
.actions__main {
  flex: 0 0 auto;
  display: flex;
  gap: 10px;
}
.free-price {
  flex: 0 0 auto;
  height: 58px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  background: #fff;
  color: var(--pos-green-dark);
  border: 1.5px solid var(--pos-border-medium);
  border-radius: var(--pos-radius-tile);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.1;
  text-align: left;
  transition: all 0.12s ease;
}
.free-price i {
  font-size: 18px;
  color: var(--pos-green);
}
.free-price:hover {
  border-color: var(--pos-green);
  background: var(--pos-green-soft);
}
.cobrar {
  flex: 1;
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
