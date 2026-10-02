<script setup lang="ts">
/**
 * "Consumo interno": goods taken for internal use and never paid (cleaning, the
 * owner…) — not sales. Records of a period valued at sale price and at cost, who
 * takes the most (to spot e.g. someone taking bleach every day), per account; and
 * the internal accounts themselves. Permissions `internal_consumption:read` and
 * `internal_account:manage`. Web + desktop (HTTP).
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  createInternalAccount,
  listConsumptions,
  listInternalAccountsOnServer,
  updateInternalAccount,
  type ConsumptionRecord,
  type InternalAccountInfo
} from '../../services/internal'
import { useCan } from '../../composables/useCan'
import { eurCents } from '../../utils/activityFormat'
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../utils/period'
import { fuzzySearch } from '../../utils/search'

const { can } = useCan()
const tab = ref<'records' | 'accounts'>(can('internal_consumption:read') ? 'records' : 'accounts')

// --- Records ---
const preset = ref<PeriodPreset>('30d')
const customRange = ref<(Date | null)[] | null>(null)
const period = computed(() => resolvePeriod(preset.value, customRange.value))
const records = ref<ConsumptionRecord[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const filtered = computed(() =>
  fuzzySearch(records.value, search.value, (r) => [
    r.takenByName,
    r.accountName,
    r.reason ?? '',
    r.userName ?? '',
    ...r.lines.map((l) => l.name)
  ])
)
const totals = computed(() => ({
  price: filtered.value.reduce((n, r) => n + r.totalCents, 0),
  cost: filtered.value.reduce((n, r) => n + r.costCents, 0),
  units: filtered.value.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.quantity, 0), 0)
}))

function groupBy(key: (r: ConsumptionRecord) => string): {
  name: string
  times: number
  units: number
  costCents: number
  priceCents: number
}[] {
  const map = new Map<
    string,
    { name: string; times: number; units: number; costCents: number; priceCents: number }
  >()
  for (const r of filtered.value) {
    const k = key(r)
    const g = map.get(k) ?? { name: k, times: 0, units: 0, costCents: 0, priceCents: 0 }
    g.times += 1
    g.units += r.lines.reduce((n, l) => n + l.quantity, 0)
    g.costCents += r.costCents
    g.priceCents += r.totalCents
    map.set(k, g)
  }
  return [...map.values()].sort((a, b) => b.costCents - a.costCents)
}
const byPerson = computed(() => groupBy((r) => r.takenByName))
const byAccount = computed(() => groupBy((r) => r.accountName))

async function loadRecords(): Promise<void> {
  if (!can('internal_consumption:read')) return
  if (preset.value === 'custom' && !customRange.value?.[1]) return
  loading.value = true
  error.value = ''
  try {
    records.value = await listConsumptions(period.value.from, period.value.to)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar el consumo interno'
  } finally {
    loading.value = false
  }
}
watch(period, loadRecords)

// --- Accounts ---
const accounts = ref<InternalAccountInfo[]>([])
const accountName = ref('')
const accountError = ref('')
const editing = ref<InternalAccountInfo | null>(null)
const editName = ref('')
const editActive = ref(true)

async function loadAccounts(): Promise<void> {
  try {
    accounts.value = await listInternalAccountsOnServer()
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'No se pudieron cargar las cuentas'
  }
}

async function addAccount(): Promise<void> {
  if (!accountName.value.trim()) return
  accountError.value = ''
  try {
    await createInternalAccount(accountName.value.trim())
    accountName.value = ''
    await loadAccounts()
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'No se pudo crear la cuenta'
  }
}

function startEdit(a: InternalAccountInfo): void {
  editing.value = a
  editName.value = a.name
  editActive.value = a.active
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return
  accountError.value = ''
  try {
    await updateInternalAccount(editing.value.id, editName.value.trim(), editActive.value)
    editing.value = null
    await loadAccounts()
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'No se pudo guardar la cuenta'
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

onMounted(() => {
  void loadRecords()
  void loadAccounts()
})
</script>

<template>
  <div class="ci">
    <div class="ci-tabs">
      <button
        v-if="can('internal_consumption:read')"
        class="ci-tab"
        :class="{ 'ci-tab--on': tab === 'records' }"
        @click="tab = 'records'"
      >
        <i class="pi pi-list"></i> Registros
      </button>
      <button
        class="ci-tab"
        :class="{ 'ci-tab--on': tab === 'accounts' }"
        @click="tab = 'accounts'"
      >
        <i class="pi pi-tags"></i> Cuentas internas
      </button>
    </div>

    <!-- Records -->
    <template v-if="tab === 'records'">
      <div class="bo-card ci-bar">
        <div class="ci-presets">
          <button
            v-for="p in PERIOD_PRESETS"
            :key="p.id"
            class="ci-preset"
            :class="{ 'ci-preset--on': preset === p.id }"
            @click="preset = p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <DatePicker
          v-if="preset === 'custom'"
          v-model="customRange"
          selection-mode="range"
          date-format="dd/mm/yy"
          placeholder="Desde – hasta"
          show-icon
          :manual-input="false"
        />
        <InputText
          v-model="search"
          placeholder="Buscar persona, producto, cuenta…"
          class="ci-search"
        />
        <Button
          icon="pi pi-refresh"
          text
          :loading="loading"
          aria-label="Actualizar"
          @click="loadRecords"
        />
      </div>
      <span v-if="error" class="bo-error">{{ error }}</span>

      <div class="ci-kpis">
        <div class="bo-card ci-kpi">
          <span>Veces</span><b>{{ filtered.length }}</b>
        </div>
        <div class="bo-card ci-kpi">
          <span>Unidades</span><b>{{ totals.units }}</b>
        </div>
        <div class="bo-card ci-kpi">
          <span>Valor a coste</span><b class="pos-money">{{ eurCents(totals.cost) }}</b>
        </div>
        <div class="bo-card ci-kpi">
          <span>Valor a precio de venta</span><b class="pos-money">{{ eurCents(totals.price) }}</b>
        </div>
      </div>

      <div class="ci-grid">
        <div class="bo-card ci-card">
          <div class="ci-title">Quién se lleva más</div>
          <DataTable :value="byPerson" size="small" data-key="name">
            <template #empty>Nada en el periodo.</template>
            <Column field="name" header="Persona" />
            <Column field="times" header="Veces" style="width: 5rem" />
            <Column field="units" header="Uds." style="width: 5rem" />
            <Column header="Coste" style="width: 7rem">
              <template #body="{ data }">{{ eurCents(data.costCents) }}</template>
            </Column>
          </DataTable>
        </div>
        <div class="bo-card ci-card">
          <div class="ci-title">Por cuenta</div>
          <DataTable :value="byAccount" size="small" data-key="name">
            <template #empty>Nada en el periodo.</template>
            <Column field="name" header="Cuenta" />
            <Column field="times" header="Veces" style="width: 5rem" />
            <Column field="units" header="Uds." style="width: 5rem" />
            <Column header="Coste" style="width: 7rem">
              <template #body="{ data }">{{ eurCents(data.costCents) }}</template>
            </Column>
          </DataTable>
        </div>
      </div>

      <div class="bo-card ci-card">
        <div class="ci-title">Registros</div>
        <DataTable :value="filtered" :loading="loading" size="small" data-key="id" striped-rows>
          <template #empty>No hay consumo interno en este periodo.</template>
          <Column header="Fecha" style="width: 9rem">
            <template #body="{ data }">{{ fmtDate(data.createdAt) }}</template>
          </Column>
          <Column header="Se lo lleva">
            <template #body="{ data }">
              <b>{{ data.takenByName }}</b>
              <small class="ci-sub"
                >{{ data.accountName }}{{ data.reason ? ` · ${data.reason}` : '' }}</small
              >
            </template>
          </Column>
          <Column header="Productos">
            <template #body="{ data }">
              {{
                data.lines
                  .map((l: { quantity: number; name: string }) => `${l.quantity} × ${l.name}`)
                  .join(', ')
              }}
            </template>
          </Column>
          <Column header="Marcado por" style="width: 8rem">
            <template #body="{ data }">
              {{ data.userName ?? '—' }} <small class="ci-sub">{{ data.terminalId }}</small>
            </template>
          </Column>
          <Column header="Coste" style="width: 6rem">
            <template #body="{ data }">{{ eurCents(data.costCents) }}</template>
          </Column>
          <Column header="PVP" style="width: 6rem">
            <template #body="{ data }">{{ eurCents(data.totalCents) }}</template>
          </Column>
          <Column field="consumptionNumber" header="Nº" style="width: 10rem" />
        </DataTable>
        <small class="ci-note"
          >El coste usa el precio de compra del producto. Si sale 0, falta ponerlo en
          Productos.</small
        >
      </div>
    </template>

    <!-- Accounts -->
    <template v-else>
      <div class="bo-card ci-card">
        <div class="ci-title">Cuentas internas</div>
        <p class="ci-help">
          A qué se apunta lo que sale sin pagar (p. ej. <b>Limpieza</b>, <b>Mantenimiento</b>,
          <b>Dirección</b>). Las cajas las reciben al arrancar o al refrescar el catálogo.
        </p>
        <div v-if="can('internal_account:manage')" class="ci-add">
          <InputText
            v-model="accountName"
            placeholder="Nueva cuenta, p. ej. Limpieza"
            @keydown.enter="addAccount"
          />
          <Button label="Añadir" icon="pi pi-plus" @click="addAccount" />
        </div>
        <span v-if="accountError" class="bo-error">{{ accountError }}</span>
        <DataTable :value="accounts" size="small" data-key="id">
          <template #empty>No hay cuentas internas.</template>
          <Column header="Cuenta">
            <template #body="{ data }">
              <template v-if="editing?.id === data.id">
                <InputText v-model="editName" />
              </template>
              <template v-else>{{ data.name }}</template>
            </template>
          </Column>
          <Column header="Estado" style="width: 10rem">
            <template #body="{ data }">
              <label v-if="editing?.id === data.id" class="ci-toggle"
                ><ToggleSwitch v-model="editActive" />
                {{ editActive ? 'Activa' : 'Inactiva' }}</label
              >
              <Tag
                v-else
                :value="data.active ? 'Activa' : 'Inactiva'"
                :severity="data.active ? 'success' : 'secondary'"
              />
            </template>
          </Column>
          <Column v-if="can('internal_account:manage')" header="" style="width: 11rem">
            <template #body="{ data }">
              <template v-if="editing?.id === data.id">
                <Button label="Guardar" size="small" @click="saveEdit" />
                <Button label="Cancelar" text size="small" @click="editing = null" />
              </template>
              <Button v-else label="Editar" text size="small" @click="startEdit(data)" />
            </template>
          </Column>
        </DataTable>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ci {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ci-tabs {
  display: flex;
  gap: 8px;
}
.ci-tab {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  background: #f1f5f9;
  font-weight: 800;
  color: var(--pos-text-2);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ci-tab--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.ci-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px;
}
.ci-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ci-preset {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  background: #f1f5f9;
  color: var(--pos-text-2);
}
.ci-preset--on {
  background: var(--pos-green-dark);
  color: #fff;
}
.ci-search {
  min-width: 240px;
  margin-left: auto;
}
.ci-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.ci-kpi {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ci-kpi span {
  font-size: 12px;
  font-weight: 800;
  color: var(--pos-text-3);
  text-transform: uppercase;
}
.ci-kpi b {
  font-size: 22px;
}
.ci-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.ci-card {
  padding: 14px 18px;
}
.ci-title {
  font-weight: 900;
  margin-bottom: 8px;
}
.ci-sub {
  display: block;
  font-size: 12px;
  color: var(--pos-text-3);
}
.ci-note,
.ci-help {
  color: var(--pos-text-3);
  font-size: 13px;
}
.ci-add {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.ci-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
@media (max-width: 900px) {
  .ci-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
  .ci-grid {
    grid-template-columns: 1fr;
  }
}
</style>
