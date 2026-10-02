<script setup lang="ts">
/**
 * "Puestos": the tills enrolled against this backend. Register a new one (gives
 * a one-time code to type on that PC), issue a new code for a replacement PC (the
 * old PC stops syncing at once) or revoke a stolen/retired one. Permission
 * `terminal:manage`. Web + desktop (HTTP).
 */
import { onMounted, reactive, ref } from 'vue'
import {
  listTerminals,
  registerTerminal,
  resetTerminalCode,
  revokeTerminal,
  type TerminalCode,
  type TerminalInfo,
  type TerminalStatus
} from '../../services/terminals'

const terminals = ref<TerminalInfo[]>([])
const loading = ref(false)
const error = ref('')

const createOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ terminalId: '', name: '' })

/** A freshly issued code, shown once. */
const issued = ref<TerminalCode | null>(null)
/** Action waiting for confirmation. */
const confirming = ref<{ kind: 'reset' | 'revoke'; terminal: TerminalInfo } | null>(null)

const STATUS: Record<TerminalStatus, { label: string; severity: string }> = {
  pending: { label: 'Esperando enrolar', severity: 'warn' },
  enrolled: { label: 'Activo', severity: 'success' },
  revoked: { label: 'Revocado', severity: 'danger' }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    terminals.value = await listTerminals()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los puestos'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  form.terminalId = ''
  form.name = ''
  formError.value = ''
  createOpen.value = true
}

async function create(): Promise<void> {
  const id = form.terminalId.trim().toUpperCase()
  if (!/^[A-Z0-9-]{1,10}$/.test(id)) {
    formError.value = 'El nº de puesto es obligatorio (letras y números, p. ej. T02)'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    issued.value = await registerTerminal(id, form.name.trim())
    createOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo dar de alta el puesto'
  } finally {
    saving.value = false
  }
}

async function runConfirmed(): Promise<void> {
  const c = confirming.value
  if (!c) return
  saving.value = true
  error.value = ''
  try {
    if (c.kind === 'reset') issued.value = await resetTerminalCode(c.terminal.terminalId)
    else await revokeTerminal(c.terminal.terminalId)
    confirming.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo completar la acción'
    confirming.value = null
  } finally {
    saving.value = false
  }
}

function fmtDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
    : '—'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button label="Nuevo puesto" icon="pi pi-plus" @click="openCreate" />
      <span class="bo-spacer" />
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Actualizar" @click="load" />
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <DataTable :value="terminals" :loading="loading" data-key="terminalId" class="bo-card">
      <template #empty>
        <div class="bo-empty">No hay puestos dados de alta.</div>
      </template>
      <Column field="terminalId" header="Puesto" style="width: 8rem" />
      <Column header="Nombre">
        <template #body="{ data }">{{ data.name || '—' }}</template>
      </Column>
      <Column header="Estado" style="width: 11rem">
        <template #body="{ data }">
          <Tag
            :value="STATUS[data.status as TerminalStatus]?.label ?? data.status"
            :severity="STATUS[data.status as TerminalStatus]?.severity"
          />
        </template>
      </Column>
      <Column header="Enrolado" style="width: 10rem">
        <template #body="{ data }">{{ fmtDate(data.enrolledAt) }}</template>
      </Column>
      <Column header="Alta" style="width: 10rem">
        <template #body="{ data }">{{ fmtDate(data.createdAt) }}</template>
      </Column>
      <Column header="" style="width: 15rem">
        <template #body="{ data }">
          <Button
            label="Nuevo código"
            text
            size="small"
            @click="confirming = { kind: 'reset', terminal: data }"
          />
          <Button
            v-if="data.status !== 'revoked'"
            label="Revocar"
            text
            size="small"
            severity="danger"
            @click="confirming = { kind: 'revoke', terminal: data }"
          />
        </template>
      </Column>
    </DataTable>

    <!-- New terminal -->
    <Dialog v-model:visible="createOpen" modal header="Nuevo puesto" :style="{ width: '28rem' }">
      <div class="bo-form">
        <label>Nº de puesto</label>
        <InputText v-model="form.terminalId" placeholder="p. ej. T02" />
        <label>Nombre <small>(opcional)</small></label>
        <InputText v-model="form.name" placeholder="p. ej. Caja barra" />
        <span v-if="formError" class="bo-error">{{ formError }}</span>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="createOpen = false" />
        <Button label="Dar de alta" :loading="saving" @click="create" />
      </template>
    </Dialog>

    <!-- One-time code, shown once -->
    <Dialog
      :visible="!!issued"
      modal
      header="Código para enrolar el puesto"
      :style="{ width: '30rem' }"
      @update:visible="(v: boolean) => !v && (issued = null)"
    >
      <template v-if="issued">
        <p class="pu-text">
          En el ordenador del puesto <b>{{ issued.terminalId }}</b
          >, en <b>Configuración inicial</b>, escribe:
        </p>
        <div class="pu-code">{{ issued.enrollmentCode }}</div>
        <p class="pu-note">
          Sirve <b>una sola vez</b>. Apúntalo ahora: no se vuelve a mostrar (si se pierde, pide un
          «Nuevo código»).
        </p>
      </template>
      <template #footer>
        <Button label="Hecho" @click="issued = null" />
      </template>
    </Dialog>

    <!-- Confirm reset / revoke -->
    <Dialog
      :visible="!!confirming"
      modal
      :header="confirming?.kind === 'revoke' ? 'Revocar puesto' : 'Nuevo código'"
      :style="{ width: '30rem' }"
      @update:visible="(v: boolean) => !v && (confirming = null)"
    >
      <p v-if="confirming?.kind === 'reset'" class="pu-text">
        El ordenador que usa ahora <b>{{ confirming.terminal.terminalId }}</b>
        <b>dejará de sincronizar</b> al momento. Úsalo para cambiar de ordenador: en el nuevo se
        enrola con el código que saldrá.
      </p>
      <p v-else-if="confirming" class="pu-text">
        <b>{{ confirming.terminal.terminalId }}</b> quedará <b>bloqueado</b>: no podrá sincronizar
        ni volver a enrolarse hasta que generes un nuevo código. Úsalo si el ordenador se pierde o
        se retira.
      </p>
      <template #footer>
        <Button label="Cancelar" text @click="confirming = null" />
        <Button
          :label="confirming?.kind === 'revoke' ? 'Revocar' : 'Generar código'"
          :severity="confirming?.kind === 'revoke' ? 'danger' : undefined"
          :loading="saving"
          @click="runConfirmed"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.bo-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.bo-spacer {
  flex: 1;
}
.bo-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bo-form label {
  font-weight: 700;
  font-size: 13px;
  margin-top: 8px;
  color: var(--pos-green-dark);
}
.bo-form small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.bo-empty {
  padding: 18px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
.pu-text {
  line-height: 1.5;
}
.pu-code {
  margin: 14px 0;
  padding: 18px;
  border-radius: 12px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font:
    900 34px/1 'Courier New',
    monospace;
  letter-spacing: 0.25em;
  text-align: center;
  user-select: all;
}
.pu-note {
  font-size: 13px;
  color: var(--pos-text-2);
}
</style>
