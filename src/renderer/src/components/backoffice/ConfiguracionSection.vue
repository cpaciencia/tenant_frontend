<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../../shared/types'
import { sanitizeShifts, type ShiftDefinition } from '../../../../shared/shifts'
import { useTerminalStore } from '../../stores/terminal'
import { configureHttp } from '../../services/http'
import { useAuthStore } from '../../stores/auth'
import { useCatalogStore } from '../../stores/catalog'
import { useCan } from '../../composables/useCan'
// TEMPORARY migration tool, embedded here (hidden from the menu). Remove for production.
import ImportSection from './ImportSection.vue'

import MoneyInput from '../common/MoneyInput.vue'
const { can } = useCan()

// Once enrolled, the terminal id is owned by the backend registration and must
// not be edited freely here.
const terminal = useTerminalStore()

/**
 * Per-terminal configuration screen. Reads the persisted settings from the Main
 * process over the IPC bridge and writes changes back through it — there is no
 * sample data here, this is the real, durable config. The customer display is
 * OFF by default; toggling it here opens/closes the second-monitor window live.
 */
// syncApiUrl is owned by the enrolment flow, not this screen.
type EditableSettings = Omit<AppSettings, 'syncApiUrl'>

const form = reactive<EditableSettings>({
  terminalId: 'T01',
  customerDisplayEnabled: false,
  printerEnabled: false,
  printerName: '',
  businessName: '',
  businessAddress: '',
  businessTaxId: '',
  businessPhone: '',
  cashFloatCents: 15000,
  shifts: DEFAULT_SETTINGS.shifts.map((s) => ({ ...s }))
})

// Shifts (turnos): a caja belongs to one. Edited as a small list; the end may be
// earlier than the start (it then wraps past midnight, e.g. 16:00–00:00).
function addShift(): void {
  form.shifts.push({ id: `shift-${Date.now()}`, name: '', start: '08:00', end: '16:00' })
}
function removeShift(index: number): void {
  form.shifts.splice(index, 1)
}

/** Edit the float in euros; stored as integer cents. */
const cashFloatEur = computed<number>({
  get: () => form.cashFloatCents / 100,
  set: (v) => {
    form.cashFloatCents = Math.max(0, Math.round((v || 0) * 100))
  }
})

const loading = ref(true)
const saving = ref(false)
const savedAt = ref(0)
const error = ref('')

// Server URL lives in the bootstrap config (outside the encrypted DB), not in
// AppSettings — it must be readable before the DB opens. Editing it here lets the
// terminal follow the backend to a new address WITHOUT re-enrolling.
const serverUrl = ref('')
const savingUrl = ref(false)
const urlSavedAt = ref(0)
const urlError = ref('')
const testing = ref(false)
const testMsg = ref('')

// Outbound sync queue (sales + Z-closures). The "force re-sync" button re-pushes
// the full local history — recovery path for when the backend DB was wiped/reset.
const syncStatus = ref<{ pending: number; total: number } | null>(null)
const resyncing = ref(false)
const syncMsg = ref('')
const syncError = ref('')

async function refreshSyncStatus(): Promise<void> {
  try {
    syncStatus.value = await window.api.sync.status()
  } catch {
    syncStatus.value = null
  }
}

async function forceResync(): Promise<void> {
  if (resyncing.value) return
  resyncing.value = true
  syncMsg.value = ''
  syncError.value = ''
  try {
    const r = await window.api.sync.resyncAll()
    syncMsg.value =
      r.pending === 0
        ? `Re-enviadas ${r.requeued} operaciones. Todo sincronizado.`
        : `Re-encoladas ${r.requeued}; quedan ${r.pending} pendientes (se reintentarán en segundo plano).`
    await refreshSyncStatus()
  } catch (e) {
    syncError.value = e instanceof Error ? e.message : 'No se pudo re-sincronizar.'
  } finally {
    resyncing.value = false
  }
}

// Clean re-pull of the catalog mirror (fixes POS-grid duplicates after a backend reset).
const refreshingCatalog = ref(false)
const catalogMsg = ref('')
const catalogError = ref('')

async function refreshCatalog(): Promise<void> {
  if (refreshingCatalog.value) return
  refreshingCatalog.value = true
  catalogMsg.value = ''
  catalogError.value = ''
  try {
    const r = await window.api.catalog.refresh()
    const n = (v: number | null): string => (v === null ? 'error' : String(v))
    if (r.categories === null && r.products === null && r.accountingGroups === null) {
      catalogError.value = 'No se pudo refrescar (¿el servidor está accesible?).'
    } else {
      // Reload the POS catalog store from the now-clean mirror so the grid updates
      // live (it caches after the first load and wouldn't otherwise refresh).
      await useCatalogStore().load()
      catalogMsg.value =
        `Catálogo refrescado: ${n(r.categories)} categorías · ${n(r.products)} productos · ` +
        `${n(r.accountingGroups)} grupos contables. Ya puedes volver a la caja.`
    }
  } catch (e) {
    catalogError.value = e instanceof Error ? e.message : 'No se pudo refrescar el catálogo.'
  } finally {
    refreshingCatalog.value = false
  }
}

function apply(settings: AppSettings): void {
  form.terminalId = settings.terminalId
  form.customerDisplayEnabled = settings.customerDisplayEnabled
  form.printerEnabled = settings.printerEnabled
  form.printerName = settings.printerName
  form.businessName = settings.businessName
  form.businessAddress = settings.businessAddress
  form.businessTaxId = settings.businessTaxId
  form.businessPhone = settings.businessPhone
  form.cashFloatCents = settings.cashFloatCents
  form.shifts = settings.shifts.map((s: ShiftDefinition) => ({ ...s }))
}

onMounted(async () => {
  try {
    apply(await window.api.settings.get())
    serverUrl.value = (await window.api.enrollment.getState()).syncApiUrl
    await refreshSyncStatus()
  } catch (e) {
    error.value = 'No se pudo cargar la configuración.'
    console.error(e)
  } finally {
    loading.value = false
  }
})

async function testServer(): Promise<void> {
  if (testing.value) return
  testing.value = true
  testMsg.value = ''
  try {
    const r = await window.api.enrollment.testConnection(serverUrl.value.trim())
    testMsg.value =
      (r.ok ? '✓ ' : '✗ ') + (r.message ?? (r.ok ? 'Conexión correcta' : 'Sin conexión'))
  } catch {
    testMsg.value = '✗ No se pudo probar la conexión'
  } finally {
    testing.value = false
  }
}

async function saveServerUrl(): Promise<void> {
  if (savingUrl.value) return
  savingUrl.value = true
  urlError.value = ''
  testMsg.value = ''
  try {
    const state = await window.api.enrollment.updateSyncApiUrl(serverUrl.value.trim())
    serverUrl.value = state.syncApiUrl
    // Re-point the renderer's HTTP client (backoffice screens) at the new URL live.
    configureHttp({ baseUrl: state.syncApiUrl, getToken: () => useAuthStore().token })
    urlSavedAt.value = Date.now()
  } catch (e) {
    urlError.value = e instanceof Error ? e.message : 'No se pudo guardar la URL del servidor.'
  } finally {
    savingUrl.value = false
  }
}

async function save(): Promise<void> {
  if (saving.value) return
  error.value = ''
  if (!sanitizeShifts(form.shifts)) {
    error.value = 'Revisa los turnos: cada uno necesita nombre y horas distintas de inicio y fin.'
    return
  }
  saving.value = true
  try {
    // IPC can only carry plain data: Vue's reactive proxies (the shifts list and
    // its rows) fail to clone, so send a plain copy.
    const patch: EditableSettings = { ...form, shifts: form.shifts.map((sh) => ({ ...sh })) }
    apply(await window.api.settings.update(patch))
    savedAt.value = Date.now()
  } catch (e) {
    error.value = `No se pudo guardar la configuración: ${e instanceof Error ? e.message : String(e)}`
    console.error(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="loading" class="cfg__loading">Cargando configuración…</div>
  <div v-else class="cfg">
    <!-- Datos del negocio (cabecera del ticket) -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-building"></i>
        <div>
          <div class="cfg__card-title">Datos del negocio</div>
          <div class="cfg__card-sub">Aparecen en la cabecera del ticket de venta.</div>
        </div>
      </div>
      <div class="cfg__row">
        <label class="cfg__label" for="cfg-bizname">Nombre</label>
        <InputText
          id="cfg-bizname"
          v-model="form.businessName"
          placeholder="Camping Parque Tropical"
        />
      </div>
      <div class="cfg__row">
        <label class="cfg__label" for="cfg-bizaddr">Dirección</label>
        <InputText
          id="cfg-bizaddr"
          v-model="form.businessAddress"
          placeholder="Calle, nº · CP Localidad"
        />
      </div>
      <div class="cfg__grid2">
        <div class="cfg__row">
          <label class="cfg__label" for="cfg-biztax">CIF / NIF</label>
          <InputText id="cfg-biztax" v-model="form.businessTaxId" placeholder="B12345678" />
        </div>
        <div class="cfg__row">
          <label class="cfg__label" for="cfg-bizphone">Teléfono</label>
          <InputText id="cfg-bizphone" v-model="form.businessPhone" placeholder="900 000 000" />
        </div>
      </div>
    </div>

    <!-- Puesto / terminal -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-desktop"></i>
        <div>
          <div class="cfg__card-title">Puesto</div>
          <div class="cfg__card-sub">
            Identificador de esta caja. Prefija cada número de ticket.
          </div>
        </div>
      </div>
      <div class="cfg__row">
        <label class="cfg__label" for="cfg-terminal">Número de puesto</label>
        <InputText
          id="cfg-terminal"
          v-model="form.terminalId"
          :disabled="terminal.enrolled"
          class="cfg__terminal"
          placeholder="T01"
        />
        <span v-if="terminal.enrolled" class="cfg__hint">
          <i class="pi pi-lock"></i> Fijado por el enrolamiento del terminal.
        </span>
        <span v-else class="cfg__hint"
          >Ej. los tickets saldrán como {{ form.terminalId || 'T01' }}-2026-00001</span
        >
      </div>
    </div>

    <!-- Caja: fondo de cambio -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-wallet"></i>
        <div>
          <div class="cfg__card-title">Caja</div>
          <div class="cfg__card-sub">
            Cada caja es de un turno. Al cerrar una caja se abre al momento la del turno siguiente
            con el fondo que se deja en el cajón.
          </div>
        </div>
      </div>
      <div class="cfg__row">
        <label class="cfg__label" for="cfg-float">Fondo de caja por defecto</label>
        <MoneyInput id="cfg-float" v-model="cashFloatEur" :min="0" class="cfg__terminal" />
      </div>
      <div class="cfg__row">
        <label class="cfg__label">Turnos</label>
        <div v-for="(shift, i) in form.shifts" :key="shift.id" class="cfg__shift">
          <InputText
            v-model="shift.name"
            placeholder="Nombre (p. ej. Mañana)"
            class="cfg__shift-name"
          />
          <input v-model="shift.start" type="time" class="cfg__shift-time" aria-label="Inicio" />
          <span>–</span>
          <input v-model="shift.end" type="time" class="cfg__shift-time" aria-label="Fin" />
          <Button
            icon="pi pi-trash"
            text
            severity="danger"
            :disabled="form.shifts.length <= 1"
            aria-label="Quitar turno"
            @click="removeShift(i)"
          />
        </div>
        <div>
          <Button label="Añadir turno" icon="pi pi-plus" text size="small" @click="addShift" />
        </div>
        <span class="cfg__hint"
          >Si el fin es anterior al inicio, el turno acaba al día siguiente (p. ej.
          16:00–00:00).</span
        >
      </div>
    </div>

    <!-- Servidor (URL del backend) -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-server"></i>
        <div>
          <div class="cfg__card-title">Servidor</div>
          <div class="cfg__card-sub">
            Dirección del backend al que sincroniza este puesto. Cámbiala si el servidor se mudó,
            sin volver a enrolar el terminal.
          </div>
        </div>
      </div>
      <div class="cfg__row">
        <label class="cfg__label" for="cfg-server">URL del servidor</label>
        <div class="cfg__server-row">
          <InputText
            id="cfg-server"
            v-model="serverUrl"
            class="cfg__server-input"
            placeholder="http://localhost:7071"
          />
          <Button
            label="Probar"
            icon="pi pi-bolt"
            severity="secondary"
            outlined
            :loading="testing"
            @click="testServer"
          />
        </div>
        <span v-if="testMsg" class="cfg__hint">{{ testMsg }}</span>
        <span v-if="urlError" class="cfg__error"
          ><i class="pi pi-exclamation-triangle"></i> {{ urlError }}</span
        >
        <span v-else-if="urlSavedAt" class="cfg__saved"
          ><i class="pi pi-check-circle"></i> URL actualizada</span
        >
        <div class="cfg__server-actions">
          <Button
            label="Guardar URL"
            icon="pi pi-save"
            :loading="savingUrl"
            @click="saveServerUrl"
          />
        </div>
      </div>
    </div>

    <!-- Sincronización -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-sync"></i>
        <div>
          <div class="cfg__card-title">Sincronización</div>
          <div class="cfg__card-sub">
            Reenvía al servidor las ventas y cierres guardados en este puesto. Útil si la base de
            datos del servidor se vació o reinició. El catálogo (productos, categorías, cajas) no se
            sube por aquí: se recupera re-importando.
          </div>
        </div>
      </div>
      <div class="cfg__sync-status">
        <span v-if="syncStatus">
          <strong>{{ syncStatus.total }}</strong> operaciones locales ·
          <strong :class="{ 'cfg__sync-pending': syncStatus.pending > 0 }">{{
            syncStatus.pending
          }}</strong>
          pendientes
        </span>
        <span v-else class="cfg__hint">Estado de la cola no disponible.</span>
      </div>
      <span v-if="syncError" class="cfg__error"
        ><i class="pi pi-exclamation-triangle"></i> {{ syncError }}</span
      >
      <span v-else-if="syncMsg" class="cfg__saved"
        ><i class="pi pi-check-circle"></i> {{ syncMsg }}</span
      >
      <div class="cfg__server-actions">
        <Button
          label="Forzar re-sincronización"
          icon="pi pi-sync"
          severity="warning"
          :loading="resyncing"
          @click="forceResync"
        />
      </div>

      <div class="cfg__sync-sep"></div>
      <div class="cfg__card-sub">
        Si la rejilla de la caja muestra categorías o productos duplicados (tras un reinicio del
        servidor), baja de nuevo el catálogo y limpia las copias obsoletas del puesto.
      </div>
      <span v-if="catalogError" class="cfg__error"
        ><i class="pi pi-exclamation-triangle"></i> {{ catalogError }}</span
      >
      <span v-else-if="catalogMsg" class="cfg__saved"
        ><i class="pi pi-check-circle"></i> {{ catalogMsg }}</span
      >
      <div class="cfg__server-actions">
        <Button
          label="Refrescar catálogo (limpiar duplicados)"
          icon="pi pi-download"
          severity="secondary"
          outlined
          :loading="refreshingCatalog"
          @click="refreshCatalog"
        />
      </div>
    </div>

    <!-- Visor de cliente -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-window-maximize"></i>
        <div>
          <div class="cfg__card-title">Visor de cliente</div>
          <div class="cfg__card-sub">
            Pantalla secundaria que muestra el carrito al cliente. Desactivado por defecto.
          </div>
        </div>
      </div>
      <div class="cfg__toggle-row">
        <ToggleSwitch v-model="form.customerDisplayEnabled" />
        <span class="cfg__toggle-text">
          {{ form.customerDisplayEnabled ? 'Activado' : 'Desactivado' }}
          <small>Se abre solo si hay un segundo monitor conectado.</small>
        </span>
      </div>
    </div>

    <!-- Impresora -->
    <div class="bo-card cfg__card">
      <div class="cfg__card-head">
        <i class="pi pi-print"></i>
        <div>
          <div class="cfg__card-title">Impresora de tickets</div>
          <div class="cfg__card-sub">
            Preferencias de impresión. La impresión térmica llegará en una fase posterior.
          </div>
        </div>
      </div>
      <div class="cfg__toggle-row">
        <ToggleSwitch v-model="form.printerEnabled" />
        <span class="cfg__toggle-text">
          {{ form.printerEnabled ? 'Imprimir ticket al cobrar' : 'No imprimir' }}
        </span>
      </div>
      <div class="cfg__row" :class="{ 'cfg__row--disabled': !form.printerEnabled }">
        <label class="cfg__label" for="cfg-printer">Impresora</label>
        <InputText
          id="cfg-printer"
          v-model="form.printerName"
          :disabled="!form.printerEnabled"
          class="cfg__terminal"
          placeholder="Nombre de la impresora del sistema"
        />
      </div>
    </div>

    <!-- Actions -->
    <div class="cfg__actions">
      <span v-if="error" class="cfg__error"
        ><i class="pi pi-exclamation-triangle"></i> {{ error }}</span
      >
      <span v-else-if="savedAt" class="cfg__saved"
        ><i class="pi pi-check-circle"></i> Cambios guardados</span
      >
      <Button label="Guardar cambios" icon="pi pi-save" :loading="saving" @click="save" />
    </div>

    <!-- Migración de datos (TEMPORAL) — herramienta de desarrollo, se retirará en producción. -->
    <div v-if="can('product:create')" class="cfg__migration">
      <div class="cfg__migration-head">
        <i class="pi pi-history"></i>
        <span>Migración de datos <em>(temporal · se retirará en producción)</em></span>
      </div>
      <ImportSection />
    </div>
  </div>
</template>

<style scoped>
.cfg__loading {
  color: var(--pos-text-2);
  font-weight: 600;
}
.cfg__migration {
  margin-top: 28px;
  padding-top: 18px;
  border-top: 2px dashed var(--pos-border-medium);
}
.cfg__migration-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-size: 14px;
  font-weight: 900;
  color: var(--pos-text-2);
}
.cfg__migration-head em {
  font-weight: 600;
  font-style: italic;
  color: var(--pos-text-3);
}
.cfg {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.cfg__card {
  padding: 22px 24px;
}
.cfg__card-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
}
.cfg__card-head > i {
  font-size: 20px;
  color: var(--pos-green);
  margin-top: 2px;
}
.cfg__card-title {
  font-size: 16px;
  font-weight: 900;
  color: var(--pos-green-dark);
}
.cfg__card-sub {
  font-size: 13px;
  color: var(--pos-text-2);
  font-weight: 600;
  margin-top: 2px;
}
.cfg__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cfg__grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.cfg__row--disabled {
  opacity: 0.55;
}
.cfg__label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.cfg__terminal {
  max-width: 320px;
}
.cfg__server-row {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: 520px;
}
.cfg__server-input {
  flex: 1;
}
.cfg__server-actions {
  margin-top: 12px;
}
.cfg__sync-status {
  font-size: 14px;
  font-weight: 600;
  color: var(--pos-text-2);
  margin-bottom: 8px;
}
.cfg__sync-pending {
  color: var(--pos-warn);
}
.cfg__sync-sep {
  height: 1px;
  background: var(--pos-border-subtle);
  margin: 18px 0 14px;
}
.cfg__hint {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.cfg__toggle-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 4px;
}
.cfg__toggle-text {
  font-size: 14px;
  font-weight: 800;
  color: var(--pos-green-dark);
  display: flex;
  flex-direction: column;
}
.cfg__toggle-text small {
  font-size: 12px;
  font-weight: 600;
  color: var(--pos-text-3);
}
.cfg__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 4px;
}
.cfg__saved {
  color: var(--pos-green-hover);
  font-weight: 800;
  font-size: 14px;
}
.cfg__error {
  color: #d33;
  font-weight: 800;
  font-size: 14px;
}
.cfg__shift {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.cfg__shift-name {
  flex: 1;
}
.cfg__shift-time {
  height: 38px;
  padding: 0 8px;
  border: 1px solid var(--pos-border-medium);
  border-radius: 6px;
  font: inherit;
}
</style>
