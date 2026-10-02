<script setup lang="ts">
/**
 * Shown at login when the open caja was left by the previous cierre and nobody
 * answers for it yet. The arriving cashier sees what they'd take over — the float
 * left in the drawer plus whatever was sold since (and by whom) — and either
 * accepts it or just sells without becoming responsible (e.g. the outgoing
 * cashier still finishing their last hour, or a reinforcement). The float is
 * editable: if what they count in the drawer differs from what was left, the
 * correction is recorded under their name and shows up in the cierre.
 */
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import { cierreShiftLabel } from '../../reports/cierreReport'
import type { SessionArqueo } from '../../../../shared/types'

import MoneyInput from '../common/MoneyInput.vue'
/** `forClose`: opened from "Cerrar caja" — a caja can't be closed without a responsible. */
const props = defineProps<{ forClose?: boolean }>()
const emit = defineEmits<{ (e: 'accepted'): void; (e: 'skip'): void }>()

const store = usePosStore()
const { currentSession } = storeToRefs(store)

const arqueo = ref<SessionArqueo | null>(null)
/** The float the arriving cashier counts, prefilled with the one left. */
const floatEur = ref((currentSession.value?.openingFloatCents ?? 0) / 100)
const floatCents = computed(() => Math.max(0, Math.round((floatEur.value || 0) * 100)))
const floatChanged = computed(() => floatCents.value !== currentSession.value?.openingFloatCents)
const expectedCents = computed(() => floatCents.value + (arqueo.value?.tenders.cashCents ?? 0))
const accepting = ref(false)
const error = ref('')

const shiftLabel = computed(() =>
  currentSession.value ? cierreShiftLabel(currentSession.value) : ''
)
const myName = computed(() => store.actor().name)

onMounted(async () => {
  const sid = currentSession.value?.id
  if (!sid) return
  try {
    arqueo.value = await window.api.cashSession.arqueo(sid)
  } catch {
    /* summary is informative only */
  }
})

async function accept(): Promise<void> {
  if (accepting.value) return
  accepting.value = true
  error.value = ''
  try {
    await store.acceptCaja(floatChanged.value ? floatCents.value : undefined)
    emit('accepted')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo aceptar la caja.'
    await store.loadSession()
  } finally {
    accepting.value = false
  }
}
</script>

<template>
  <div class="ac-overlay">
    <div class="ac-card">
      <div class="ac-icon"><i class="pi pi-inbox"></i></div>
      <div class="ac-title">Caja {{ shiftLabel }}</div>
      <div class="ac-sub">
        La dejó abierta <b>{{ currentSession?.cashierName }}</b> al cerrar la anterior. Todavía no
        tiene responsable.
      </div>
      <div v-if="props.forClose" class="ac-for-close">
        Para cerrarla, alguien tiene que hacerse responsable de ella primero.
      </div>

      <div class="ac-rows">
        <label class="ac-row ac-row--input" for="ac-float">
          <span>Fondo que hay en el cajón</span>
          <MoneyInput id="ac-float" v-model="floatEur" :min="0" class="ac-float" />
        </label>
        <div v-if="floatChanged" class="ac-row ac-row--note">
          Dejaron {{ eur((currentSession?.openingFloatCents ?? 0) / 100) }} · se registrará la
          corrección a tu nombre
        </div>
        <div class="ac-row">
          <span>Vendido desde entonces ({{ arqueo?.salesCount ?? 0 }})</span>
          <b class="pos-money">{{ eur((arqueo?.totalCents ?? 0) / 100) }}</b>
        </div>
        <div
          v-for="s in arqueo?.sellers ?? []"
          :key="s.userId ?? s.name"
          class="ac-row ac-row--sub"
        >
          <span>· {{ s.name }}</span>
          <span class="pos-money">{{ eur(s.totalCents / 100) }}</span>
        </div>
        <div class="ac-row ac-row--strong">
          <span>Efectivo que debería haber</span>
          <b class="pos-money">{{ eur(expectedCents / 100) }}</b>
        </div>
      </div>

      <span v-if="error" class="ac-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <button class="ac-btn" :disabled="accepting" @click="accept">
        {{ accepting ? 'ACEPTANDO…' : `ACEPTAR · ME HAGO RESPONSABLE (${myName})` }}
      </button>
      <button class="ac-skip" :disabled="accepting" @click="emit('skip')">
        {{ props.forClose ? 'Cancelar' : 'Solo vender, no soy el responsable de este turno' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ac-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.ac-card {
  width: 440px;
  max-width: 92vw;
  background: #fff;
  border-radius: 18px;
  padding: 28px 28px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--pos-shadow-modal);
  text-align: center;
}
.ac-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 2px;
  border-radius: 50%;
  background: var(--pos-warn-bg);
  color: var(--pos-warn);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}
.ac-title {
  font-size: 21px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.ac-sub {
  font-size: 14px;
  color: var(--pos-text-2);
}
.ac-for-close {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-warn);
}
.ac-rows {
  text-align: left;
  background: #f8fafc;
  border-radius: 12px;
  padding: 10px 14px;
  margin: 6px 0;
}
.ac-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: var(--pos-text-2);
  padding: 3px 0;
}
.ac-row--input {
  align-items: center;
  gap: 12px;
}
.ac-float {
  width: 150px;
}
.ac-row--note {
  font-size: 12px;
  font-weight: 700;
  color: var(--pos-warn);
}
.ac-row--sub {
  font-size: 13px;
  color: var(--pos-text-3);
  padding-left: 8px;
}
.ac-row--strong {
  font-weight: 900;
  color: var(--pos-green-dark);
  border-top: 1px dashed var(--pos-border-medium);
  margin-top: 4px;
  padding-top: 7px;
}
.ac-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.ac-btn {
  height: 54px;
  background: var(--pos-green);
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.03em;
  border-radius: 12px;
}
.ac-btn:hover:not(:disabled) {
  background: var(--pos-green-hover);
}
.ac-btn:disabled {
  background: var(--pos-text-disabled);
}
.ac-skip {
  height: 42px;
  background: #f1f5f9;
  color: var(--pos-text-2);
  font-weight: 700;
  font-size: 13px;
  border-radius: 10px;
}
</style>
