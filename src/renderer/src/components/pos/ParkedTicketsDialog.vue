<script setup lang="ts">
/**
 * Tickets set aside unpaid ("Aparcar") to serve another customer. Resume one to
 * keep selling it (the current ticket, if any, is parked first so nothing is
 * lost) or discard it. Every action is recorded in the audit log with its content.
 */
import { onMounted, ref } from 'vue'
import { usePosStore } from '../../stores/pos'
import { eur } from '../../data/catalog'
import type { ParkedTicket } from '../../../../shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = usePosStore()

const tickets = ref<ParkedTicket[]>([])
const confirmingDiscard = ref<string | null>(null)
const busy = ref(false)
const error = ref('')

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

async function load(): Promise<void> {
  tickets.value = await store.refreshParked()
  if (tickets.value.length === 0) emit('close')
}
onMounted(load)

async function resume(t: ParkedTicket): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await store.resumeParked(t.id)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo recuperar el ticket.'
    await load()
  } finally {
    busy.value = false
  }
}

async function discard(t: ParkedTicket): Promise<void> {
  if (confirmingDiscard.value !== t.id) {
    confirmingDiscard.value = t.id
    return
  }
  busy.value = true
  error.value = ''
  try {
    await store.discardParked(t.id)
    confirmingDiscard.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo descartar.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pk-overlay" @click.self="emit('close')">
    <div class="pk-card">
      <div class="pk-head">
        <div class="pk-title"><i class="pi pi-inbox"></i> Tickets aparcados</div>
        <button class="pk-close" aria-label="Cerrar" @click="emit('close')">
          <i class="pi pi-times"></i>
        </button>
      </div>
      <div v-if="!store.isEmpty" class="pk-note">
        El ticket que tienes ahora se aparcará al recuperar otro.
      </div>
      <span v-if="error" class="pk-error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >

      <div class="pk-list">
        <div v-for="t in tickets" :key="t.id" class="pk-item">
          <div class="pk-main">
            <div class="pk-total pos-money">{{ eur(t.totalCents / 100) }}</div>
            <div class="pk-meta">
              {{ fmtTime(t.parkedAt) }} · hace {{ minutesAgo(t.parkedAt) }} min ·
              {{ t.parkedByName }}
            </div>
            <div class="pk-lines">
              {{ t.lines.map((l) => `${l.qty} × ${l.name}`).join(', ') }}
            </div>
          </div>
          <button class="pk-btn pk-btn--ok" :disabled="busy" @click="resume(t)">Recuperar</button>
          <button class="pk-btn pk-btn--del" :disabled="busy" @click="discard(t)">
            {{ confirmingDiscard === t.id ? '¿Seguro?' : 'Descartar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pk-overlay {
  position: absolute;
  inset: 0;
  background: rgba(8, 20, 13, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2500;
}
.pk-card {
  width: 620px;
  max-width: 94vw;
  max-height: 88vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: var(--pos-shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--pos-green-dark);
  color: #fff;
}
.pk-title {
  font-size: 18px;
  font-weight: 900;
  display: flex;
  gap: 8px;
  align-items: center;
}
.pk-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.pk-note {
  margin: 12px 20px 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--pos-warn);
}
.pk-error {
  margin: 10px 20px 0;
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
.pk-list {
  padding: 12px 20px 18px;
  overflow-y: auto;
}
.pk-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--pos-border-subtle);
  border-radius: 12px;
  margin-top: 10px;
}
.pk-main {
  flex: 1;
  min-width: 0;
}
.pk-total {
  font-size: 20px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.pk-meta {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.pk-lines {
  font-size: 13px;
  color: var(--pos-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pk-btn {
  height: 48px;
  padding: 0 18px;
  border-radius: 10px;
  font-weight: 900;
  font-size: 14px;
}
.pk-btn:disabled {
  opacity: 0.5;
}
.pk-btn--ok {
  background: var(--pos-green);
  color: #fff;
}
.pk-btn--del {
  background: var(--pos-danger-bg);
  color: var(--pos-danger);
}
</style>
