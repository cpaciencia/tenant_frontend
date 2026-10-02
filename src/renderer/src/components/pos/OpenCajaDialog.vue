<script setup lang="ts">
/**
 * Blocking "Abrir caja" screen, shown only when the terminal has NO open caja —
 * in practice the very first time (every cierre already opens the next shift's
 * caja). The caja belongs to a shift; whoever opens it by hand is its responsible.
 * The float defaults to what the last cierre left in the drawer.
 */
import { onMounted, ref } from 'vue'
import { usePosStore } from '../../stores/pos'
import { DEFAULT_SETTINGS } from '../../../../shared/types'
import { resolveShiftAt, type ShiftDefinition } from '../../../../shared/shifts'

import MoneyInput from '../common/MoneyInput.vue'
const emit = defineEmits<{ (e: 'logout'): void }>()

const store = usePosStore()

const floatEur = ref(DEFAULT_SETTINGS.cashFloatCents / 100)
const shifts = ref<ShiftDefinition[]>(DEFAULT_SETTINGS.shifts)
const shiftId = ref<string | null>(
  resolveShiftAt(DEFAULT_SETTINGS.shifts, new Date())?.shiftId ?? null
)
const opening = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const [settings, lastFloat] = await Promise.all([
      window.api.settings.get(),
      window.api.cashSession.lastClosingFloat()
    ])
    shifts.value = settings.shifts
    shiftId.value = resolveShiftAt(settings.shifts, new Date())?.shiftId ?? null
    floatEur.value = (lastFloat ?? settings.cashFloatCents) / 100
  } catch {
    /* keep defaults */
  }
})

async function open(): Promise<void> {
  if (opening.value) return
  opening.value = true
  error.value = ''
  try {
    await store.openCaja({
      shiftId: shiftId.value,
      openingFloatCents: Math.max(0, Math.round((floatEur.value || 0) * 100))
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo abrir la caja.'
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <div class="oc-overlay">
    <div class="oc-card">
      <div class="oc-icon"><i class="pi pi-wallet"></i></div>
      <div class="oc-title">Abrir caja</div>
      <div class="oc-sub">No hay ninguna caja abierta en este terminal.</div>

      <label class="oc-label">Turno</label>
      <div class="oc-shifts">
        <button
          v-for="s in shifts"
          :key="s.id"
          class="oc-shift"
          :class="{ 'oc-shift--active': shiftId === s.id }"
          @click="shiftId = s.id"
        >
          <b>{{ s.name }}</b>
          <small>{{ s.start }}–{{ s.end }}</small>
        </button>
      </div>

      <label class="oc-label" for="oc-float">Fondo de cambio</label>
      <MoneyInput id="oc-float" v-model="floatEur" :min="0" fluid @keydown.enter="open" />

      <span v-if="error" class="oc-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <button class="oc-btn" :disabled="opening" @click="open">
        {{ opening ? 'ABRIENDO…' : 'ABRIR CAJA' }}
      </button>
      <button class="oc-logout" :disabled="opening" @click="emit('logout')">
        <i class="pi pi-sign-out"></i> Cambiar de usuario
      </button>
    </div>
  </div>
</template>

<style scoped>
.oc-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.oc-card {
  width: 400px;
  max-width: 92vw;
  background: #fff;
  border-radius: 18px;
  padding: 32px 30px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--pos-shadow-modal);
  text-align: center;
}
.oc-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 4px;
  border-radius: 50%;
  background: var(--pos-green-soft);
  color: var(--pos-green);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
}
.oc-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.oc-sub {
  font-size: 14px;
  color: var(--pos-text-2);
  margin-bottom: 8px;
}
.oc-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
  text-align: left;
}
.oc-shifts {
  display: flex;
  gap: 8px;
}
.oc-shift {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-radius: 10px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  border: 2px solid transparent;
}
.oc-shift small {
  font-size: 12px;
  color: var(--pos-text-3);
}
.oc-shift--active {
  background: var(--pos-green-soft);
  border-color: var(--pos-green);
  color: var(--pos-green-dark);
}
.oc-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.oc-btn {
  margin-top: 10px;
  height: 54px;
  background: var(--pos-green);
  color: #fff;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 0.04em;
  border-radius: 12px;
  transition: background 0.12s ease;
}
.oc-btn:hover:not(:disabled) {
  background: var(--pos-green-hover);
}
.oc-logout {
  height: 40px;
  background: transparent;
  color: var(--pos-text-2);
  font-weight: 700;
  font-size: 13px;
  border-radius: 10px;
}
.oc-logout:hover {
  background: #f1f5f9;
}
.oc-btn:disabled {
  background: var(--pos-text-disabled);
  cursor: not-allowed;
}
</style>
