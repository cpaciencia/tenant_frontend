<script setup lang="ts">
/**
 * "Producto" (no barcode): sell something without a barcode by typing its price on a big
 * touch keypad (the physical keyboard works too), choosing its category (Tienda by
 * default — that decides the accounting group) and the quantity. The line is
 * added to the ticket and, once paid, becomes a pending item to identify later.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { useCatalogStore } from '../../stores/catalog'
import { eur } from '../../data/catalog'
import { parseMoneyInput } from '../../utils/money'

const store = usePosStore()
const catalog = useCatalogStore()
const { buffer, freePriceOpen } = storeToRefs(store)

const MAX_INT_DIGITS = 5
const amount = ref('')
const quantity = ref(Math.max(1, parseInt(buffer.value, 10) || 1))
const categoryId = ref<string | null>(catalog.quickSaleCategory()?.id ?? null)
const error = ref('')

const priceEur = computed(() => (amount.value ? parseMoneyInput(amount.value) : null))
const lineTotal = computed(() => (priceEur.value ?? 0) * quantity.value)

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫']

function press(key: string): void {
  error.value = ''
  if (key === '⌫') {
    amount.value = amount.value.slice(0, -1)
    return
  }
  if (key === 'C') {
    amount.value = ''
    return
  }
  const [intPart, decPart] = amount.value.split(',')
  if (key === ',') {
    if (decPart === undefined) amount.value = (amount.value || '0') + ','
    return
  }
  if (!/^\d$/.test(key)) return
  if (decPart !== undefined) {
    if (decPart.length < 2) amount.value += key
  } else if (intPart === '0') {
    amount.value = key
  } else if (intPart.length < MAX_INT_DIGITS) {
    amount.value += key
  }
}

/** Physical keyboard: digits, "," or "." (decimal), Backspace, Escape, Enter. */
function onKeydown(e: KeyboardEvent): void {
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === ',' || e.key === '.' || e.code === 'NumpadDecimal') press(',')
  else if (e.key === 'Backspace') press('⌫')
  else if (e.key === 'Escape') close()
  else if (e.key === 'Enter') add()
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

function close(): void {
  freePriceOpen.value = false
}

function add(): void {
  if (!priceEur.value || priceEur.value <= 0) {
    error.value = 'Teclea el precio.'
    return
  }
  store.addFreePriceLine(priceEur.value, categoryId.value, 'Producto', quantity.value)
  close()
}
</script>

<template>
  <div class="fp-overlay" @click.self="close">
    <div class="fp-card">
      <div class="fp-head">
        <div class="fp-title"><i class="pi pi-euro"></i> Producto sin código</div>
        <button class="fp-close" aria-label="Cerrar" @click="close">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="fp-display" :class="{ 'fp-display--empty': !amount }">
        {{ amount ? `${amount} €` : '0,00 €' }}
      </div>

      <div class="fp-keys">
        <button
          v-for="k in KEYS"
          :key="k"
          class="fp-key"
          :class="{ 'fp-key--soft': k === ',' || k === '⌫' }"
          @click="press(k)"
        >
          {{ k }}
        </button>
      </div>

      <div class="fp-label">Categoría</div>
      <div class="fp-cats">
        <button
          v-for="c in catalog.rootCategories"
          :key="c.id"
          class="fp-cat"
          :class="{ 'fp-cat--on': categoryId === c.id }"
          @click="categoryId = c.id"
        >
          {{ c.name }}
        </button>
      </div>

      <div class="fp-qty">
        <span class="fp-label">Cantidad</span>
        <button class="fp-qty__btn" :disabled="quantity <= 1" @click="quantity--">−</button>
        <b>{{ quantity }}</b>
        <button class="fp-qty__btn" @click="quantity++">+</button>
        <span class="fp-total pos-money">{{ eur(lineTotal) }}</span>
      </div>

      <span v-if="error" class="fp-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <div class="fp-foot">
        <button class="fp-cancel" @click="close">Cancelar</button>
        <button class="fp-add" @click="add">AÑADIR AL TICKET</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fp-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2600;
}
.fp-card {
  width: 440px;
  max-width: 94vw;
  max-height: 96vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 18px;
  padding: 18px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--pos-shadow-modal);
}
.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fp-title {
  font-size: 19px;
  font-weight: 900;
  color: var(--pos-green-dark);
  display: flex;
  align-items: center;
  gap: 8px;
}
.fp-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.fp-display {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 18px;
  border-radius: 12px;
  background: #f4f7f9;
  font-size: 34px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: var(--pos-green-dark);
}
.fp-display--empty {
  color: var(--pos-text-3);
}
.fp-keys {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.fp-key {
  height: 58px;
  border-radius: 12px;
  font-size: 22px;
  font-weight: 900;
  background: #fff;
  color: var(--pos-text);
  border: 1.5px solid var(--pos-border-subtle);
}
.fp-key:active {
  background: var(--pos-green-soft);
}
.fp-key--soft {
  background: #f1f5f9;
}
.fp-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.fp-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fp-cat {
  min-height: 44px;
  padding: 0 16px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 800;
  background: #f4f7f9;
  color: var(--pos-text-2);
  border: 1.5px solid transparent;
}
.fp-cat--on {
  background: var(--pos-green-soft);
  border-color: var(--pos-green);
  color: var(--pos-green-dark);
}
.fp-qty {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fp-qty b {
  min-width: 24px;
  text-align: center;
  font-size: 18px;
}
.fp-qty__btn {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #f1f5f9;
  font-size: 20px;
  font-weight: 900;
}
.fp-qty__btn:disabled {
  opacity: 0.4;
}
.fp-total {
  margin-left: auto;
  font-size: 18px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.fp-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.fp-foot {
  display: flex;
  gap: 10px;
}
.fp-cancel {
  height: 54px;
  padding: 0 18px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  font-weight: 800;
  border-radius: 12px;
}
.fp-add {
  flex: 1;
  height: 54px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 900;
  letter-spacing: 0.03em;
  border-radius: 12px;
}
</style>
