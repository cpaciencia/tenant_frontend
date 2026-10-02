<script setup lang="ts">
/**
 * Euro amount input for the till and the backoffice. Unlike a strict es-ES number
 * field, it takes "," AND "." (incl. the numeric keypad's) as the decimal mark, so
 * "142.5" is 142,50 € — never 1.425 €. While focused it shows the plain editable
 * number; on blur, the formatted amount. Extra attributes (id, placeholder,
 * autofocus…) and listeners (e.g. @keydown.enter) go to the inner input.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { formatMoney, parseMoneyInput, toEditableMoney } from '../../utils/money'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    /** Lower bound (ignored when `allowNegative`). */
    min?: number
    max?: number
    /** Allow a leading "-" (e.g. deposit refund products have negative prices). */
    allowNegative?: boolean
    maxFractionDigits?: number
    invalid?: boolean
    fluid?: boolean
  }>(),
  {
    min: 0,
    max: Number.POSITIVE_INFINITY,
    allowNegative: false,
    maxFractionDigits: 2,
    invalid: false,
    fluid: false
  }
)
const emit = defineEmits<{ (e: 'update:modelValue', value: number | null): void }>()

const focused = ref(false)
const text = ref('')

const shown = computed(() =>
  focused.value ? text.value : formatMoney(props.modelValue, props.maxFractionDigits)
)

// Keep the editable text in step with outside changes (not while typing).
watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) text.value = toEditableMoney(value, props.maxFractionDigits)
  },
  { immediate: true }
)

function onFocus(event: FocusEvent): void {
  focused.value = true
  text.value = toEditableMoney(props.modelValue, props.maxFractionDigits)
  // Select it all so typing replaces the amount. nextTick (a microtask) runs
  // before the next keystroke is handled, unlike a frame callback, so a fast
  // typist never loses the first digit.
  const input = event.target as HTMLInputElement | null
  nextTick(() => input?.select())
}

/**
 * The numeric keypad's decimal key yields "." or "," (or nothing) depending on
 * the OS keyboard layout. Insert the decimal mark ourselves so it always works.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.code !== 'NumpadDecimal') return
  event.preventDefault()
  const input = event.target as HTMLInputElement
  input.setRangeText(
    ',',
    input.selectionStart ?? input.value.length,
    input.selectionEnd ?? input.value.length,
    'end'
  )
  applyTyped(input.value)
}

function onInput(event: Event): void {
  applyTyped((event.target as HTMLInputElement).value)
}

function applyTyped(typed: string): void {
  // Only digits and separators (plus a leading "-" when allowed) make it in.
  const negative = props.allowNegative && typed.trim().startsWith('-')
  const raw = (negative ? '-' : '') + typed.replace(/[^\d.,]/g, '')
  text.value = raw
  const value = parseMoneyInput(raw, props.maxFractionDigits)
  emit('update:modelValue', value === null ? null : clamp(value))
}

function clamp(value: number): number {
  const low = props.allowNegative ? Number.NEGATIVE_INFINITY : props.min
  return Math.min(props.max, Math.max(low, value))
}

function onBlur(): void {
  focused.value = false
}
</script>

<template>
  <InputText
    v-bind="$attrs"
    :model-value="shown"
    inputmode="decimal"
    autocomplete="off"
    :invalid="invalid"
    :fluid="fluid"
    class="money-input"
    @focus="onFocus"
    @keydown="onKeydown"
    @input="onInput"
    @blur="onBlur"
  />
</template>

<style scoped>
.money-input {
  font-variant-numeric: tabular-nums;
}
</style>
