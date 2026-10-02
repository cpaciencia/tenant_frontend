<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useTerminalStore } from '../../stores/terminal'

/**
 * Terminal configuration + enrolment form. Reused by the first-run SetupView
 * (full screen) and by the gear dialog on the login screen. Talks to Main over
 * the `enrollment:*` bridge and keeps the terminal store in sync.
 */
const emit = defineEmits<{ enrolled: [] }>()

const terminal = useTerminalStore()

const form = reactive({
  syncApiUrl: terminal.syncApiUrl,
  terminalId: terminal.terminalId,
  code: ''
})

const enrolled = ref(terminal.enrolled)
const enrolledTerminalId = ref(terminal.terminalId)

const testing = ref(false)
const enrolling = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const error = ref('')

onMounted(async () => {
  if (!terminal.loaded) await terminal.load()
  form.syncApiUrl = terminal.syncApiUrl
  form.terminalId = terminal.terminalId
  enrolled.value = terminal.enrolled
  enrolledTerminalId.value = terminal.terminalId
})

async function testConnection(): Promise<void> {
  if (!form.syncApiUrl.trim()) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = (await window.api.enrollment.testConnection(form.syncApiUrl)) as {
      ok: boolean
      message: string
    }
  } finally {
    testing.value = false
  }
}

async function enroll(): Promise<void> {
  error.value = ''
  if (!form.syncApiUrl.trim() || !form.terminalId.trim() || !form.code.trim()) {
    error.value = 'Rellena URL, número de puesto y código.'
    return
  }
  enrolling.value = true
  try {
    const result = await window.api.enrollment.enroll({
      syncApiUrl: form.syncApiUrl.trim(),
      terminalId: form.terminalId.trim(),
      code: form.code.trim()
    })
    if (!result.ok) {
      error.value = result.message ?? 'No se pudo enrolar el terminal.'
      return
    }
    if (result.state) terminal.apply(result.state)
    enrolled.value = true
    enrolledTerminalId.value = terminal.terminalId
    form.code = ''
    emit('enrolled')
  } finally {
    enrolling.value = false
  }
}

async function unenroll(): Promise<void> {
  const state = await window.api.enrollment.reset()
  terminal.apply(state)
  enrolled.value = false
  testResult.value = null
}
</script>

<template>
  <div class="enroll">
    <!-- Already enrolled: show status + re-enrol affordance -->
    <div v-if="enrolled" class="enroll__status">
      <i class="pi pi-check-circle"></i>
      <div>
        <div class="enroll__status-title">Terminal enrolado</div>
        <div class="enroll__status-sub">
          Puesto <b>{{ enrolledTerminalId }}</b> · {{ form.syncApiUrl }}
        </div>
      </div>
      <Button label="Re-enrolar" severity="secondary" size="small" outlined @click="unenroll" />
    </div>

    <template v-else>
      <label class="enroll__label" for="enroll-url">URL del backend</label>
      <div class="enroll__row">
        <InputText
          id="enroll-url"
          v-model="form.syncApiUrl"
          class="enroll__grow"
          placeholder="http://localhost:7071"
        />
        <Button
          label="Probar"
          icon="pi pi-wifi"
          severity="secondary"
          :loading="testing"
          @click="testConnection"
        />
      </div>
      <div
        v-if="testResult"
        class="enroll__test"
        :class="testResult.ok ? 'enroll__test--ok' : 'enroll__test--ko'"
      >
        <i :class="testResult.ok ? 'pi pi-check' : 'pi pi-times'"></i> {{ testResult.message }}
      </div>

      <label class="enroll__label" for="enroll-terminal">Número de puesto</label>
      <InputText id="enroll-terminal" v-model="form.terminalId" placeholder="T01" />

      <label class="enroll__label" for="enroll-code">Código de enrolamiento</label>
      <InputText id="enroll-code" v-model="form.code" class="enroll__code" placeholder="XXXXXXXX" />

      <div v-if="error" class="enroll__error">
        <i class="pi pi-exclamation-circle"></i> {{ error }}
      </div>

      <Button
        label="Enrolar terminal"
        icon="pi pi-shield"
        class="enroll__submit"
        :loading="enrolling"
        @click="enroll"
      />
    </template>
  </div>
</template>

<style scoped>
.enroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.enroll__label {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-2);
  margin-top: 8px;
  letter-spacing: 0.02em;
}
.enroll__row {
  display: flex;
  gap: 8px;
}
.enroll__grow {
  flex: 1;
}
.enroll__code {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 800;
}
.enroll__test {
  font-size: 13px;
  font-weight: 700;
}
.enroll__test--ok {
  color: var(--pos-green-hover);
}
.enroll__test--ko {
  color: var(--pos-danger);
}
.enroll__error {
  color: var(--pos-danger);
  font-size: 13px;
  font-weight: 700;
}
.enroll__submit {
  margin-top: 12px;
}
.enroll__status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--pos-green-soft);
  border-radius: 10px;
}
.enroll__status > i {
  font-size: 22px;
  color: var(--pos-green-hover);
}
.enroll__status-title {
  font-weight: 900;
  color: var(--pos-green-dark);
}
.enroll__status-sub {
  font-size: 13px;
  color: var(--pos-text-2);
}
.enroll__status :deep(.p-button) {
  margin-left: auto;
}
</style>
