<script setup lang="ts">
/**
 * "Clientes": the "a cuenta" clients across all tills with what each owes
 * (credit sales − debt payments), add/edit them, and see a client's account line
 * by line. Debts are collected at the till (Clientes / cobro), never here.
 * Permissions `client:read` / `client:create` / `client:update`. Web + desktop.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  clientMovements,
  createClientOnServer,
  listClientSummaries,
  updateClientOnServer,
  type ClientAccountMovement,
  type ClientSummary
} from '../../services/clients'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'
import { eurCents } from '../../utils/activityFormat'

const { can } = useCan()

const clients = ref<ClientSummary[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const onlyDebtors = ref(false)
const showInactive = ref(false)

const filtered = computed(() =>
  fuzzySearch(
    clients.value.filter(
      (c) => (showInactive.value || c.active) && (!onlyDebtors.value || c.balanceCents > 0)
    ),
    search.value,
    (c) => [c.name, c.detail ?? '', c.phone ?? '']
  )
)
const totalOwed = computed(() => clients.value.reduce((n, c) => n + Math.max(0, c.balanceCents), 0))
const debtors = computed(() => clients.value.filter((c) => c.balanceCents > 0).length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    clients.value = await listClientSummaries()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los clientes'
  } finally {
    loading.value = false
  }
}

// --- Create / edit ---
const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const form = reactive({ name: '', detail: '', phone: '', active: true })

function openCreate(): void {
  editingId.value = null
  Object.assign(form, { name: '', detail: '', phone: '', active: true })
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(c: ClientSummary): void {
  editingId.value = c.id
  Object.assign(form, {
    name: c.name,
    detail: c.detail ?? '',
    phone: c.phone ?? '',
    active: c.active
  })
  formError.value = ''
  dialogOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    formError.value = 'El nombre es obligatorio'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    name: form.name.trim(),
    detail: form.detail.trim() || null,
    phone: form.phone.trim() || null,
    active: form.active
  }
  try {
    if (editingId.value) await updateClientOnServer(editingId.value, body)
    else await createClientOnServer(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar el cliente'
  } finally {
    saving.value = false
  }
}

// --- Account ---
const account = ref<{ client: ClientSummary; movements: ClientAccountMovement[] } | null>(null)
const accountLoading = ref(false)

async function openAccount(c: ClientSummary): Promise<void> {
  account.value = { client: c, movements: [] }
  accountLoading.value = true
  try {
    account.value = { client: c, movements: await clientMovements(c.id) }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo cargar la cuenta'
  } finally {
    accountLoading.value = false
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
      <Button
        v-if="can('client:create')"
        label="Nuevo cliente"
        icon="pi pi-user-plus"
        @click="openCreate"
      />
      <span class="cli-owed">
        Deben <b class="pos-money">{{ eurCents(totalOwed) }}</b>
        <small>({{ debtors }} cliente(s))</small>
      </span>
      <span class="bo-spacer" />
      <label class="bo-toggle"><ToggleSwitch v-model="onlyDebtors" /> Solo los que deben</label>
      <label class="bo-toggle"><ToggleSwitch v-model="showInactive" /> Ver inactivos</label>
      <InputText
        v-model="search"
        placeholder="Buscar nombre, parcela, teléfono…"
        class="bo-search"
      />
      <Button icon="pi pi-refresh" text :loading="loading" aria-label="Actualizar" @click="load" />
    </div>
    <span v-if="error" class="bo-error">{{ error }}</span>

    <DataTable :value="filtered" :loading="loading" data-key="id" class="bo-card">
      <template #empty>
        <div class="bo-empty">
          No hay clientes. Se crean aquí o en la caja al cobrar «A cuenta».
        </div>
      </template>
      <Column field="name" header="Cliente" sortable>
        <template #body="{ data }">
          <b>{{ data.name }}</b>
          <small v-if="data.detail" class="cli-sub">{{ data.detail }}</small>
        </template>
      </Column>
      <Column header="Teléfono" style="width: 9rem">
        <template #body="{ data }">{{ data.phone ?? '—' }}</template>
      </Column>
      <Column field="creditCents" header="Comprado a cuenta" sortable style="width: 10rem">
        <template #body="{ data }"
          ><span class="pos-money">{{ eurCents(data.creditCents) }}</span></template
        >
      </Column>
      <Column field="paidCents" header="Pagado" sortable style="width: 8rem">
        <template #body="{ data }"
          ><span class="pos-money">{{ eurCents(data.paidCents) }}</span></template
        >
      </Column>
      <Column field="balanceCents" header="Debe" sortable style="width: 8rem">
        <template #body="{ data }">
          <b class="pos-money" :class="data.balanceCents > 0 ? 'cli-debt' : 'cli-zero'">{{
            data.balanceCents > 0 ? eurCents(data.balanceCents) : '—'
          }}</b>
        </template>
      </Column>
      <Column field="lastMovementAt" header="Último movimiento" sortable style="width: 10rem">
        <template #body="{ data }">{{ fmtDate(data.lastMovementAt) }}</template>
      </Column>
      <Column header="Estado" style="width: 7rem">
        <template #body="{ data }">
          <Tag
            :value="data.active ? 'Activo' : 'Inactivo'"
            :severity="data.active ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column header="" style="width: 10rem">
        <template #body="{ data }">
          <Button label="Cuenta" text size="small" @click="openAccount(data)" />
          <Button
            v-if="can('client:update')"
            label="Editar"
            text
            size="small"
            @click="openEdit(data)"
          />
        </template>
      </Column>
    </DataTable>

    <!-- Create / edit -->
    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editingId ? 'Editar cliente' : 'Nuevo cliente'"
      :style="{ width: '30rem' }"
    >
      <div class="bo-form">
        <label>Nombre</label>
        <InputText v-model="form.name" placeholder="p. ej. Familia Müller" />
        <label>Parcela / detalle <small>(opcional)</small></label>
        <InputText v-model="form.detail" placeholder="p. ej. Parcela 14 · estancia larga" />
        <label>Teléfono <small>(opcional)</small></label>
        <InputText v-model="form.phone" />
        <div class="bo-toggle bo-toggle--form">
          <ToggleSwitch v-model="form.active" />
          <span>{{
            form.active ? 'Activo' : 'Inactivo (no aparece en las cajas si no debe nada)'
          }}</span>
        </div>
        <span v-if="formError" class="bo-error">{{ formError }}</span>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="dialogOpen = false" />
        <Button label="Guardar" :loading="saving" @click="submit" />
      </template>
    </Dialog>

    <!-- Account -->
    <Dialog
      :visible="!!account"
      modal
      :header="account ? `Cuenta de ${account.client.name}` : ''"
      :style="{ width: '44rem' }"
      @update:visible="(v: boolean) => !v && (account = null)"
    >
      <template v-if="account">
        <div class="cli-account-head">
          <span
            >Debe
            <b
              class="pos-money"
              :class="account.client.balanceCents > 0 ? 'cli-debt' : 'cli-zero'"
              >{{ eurCents(Math.max(0, account.client.balanceCents)) }}</b
            ></span
          >
          <small>Las deudas se cobran en la caja (botón «Clientes»).</small>
        </div>
        <DataTable :value="account.movements" :loading="accountLoading" size="small" data-key="id">
          <template #empty>Sin movimientos.</template>
          <Column header="Fecha" style="width: 9rem">
            <template #body="{ data }">{{ fmtDate(data.createdAt) }}</template>
          </Column>
          <Column header="Movimiento">
            <template #body="{ data }">
              {{ data.kind === 'payment' ? 'Pago' : 'Compra a cuenta' }} ·
              <span class="cli-sub-inline">{{ data.reference }}</span>
              <small v-if="data.kind === 'payment'" class="cli-sub">
                {{
                  [
                    data.cashCents ? `efectivo ${eurCents(data.cashCents)}` : '',
                    data.cardCents ? `tarjeta ${eurCents(data.cardCents)}` : ''
                  ]
                    .filter(Boolean)
                    .join(' + ')
                }}
              </small>
            </template>
          </Column>
          <Column field="terminalId" header="Puesto" style="width: 6rem" />
          <Column header="Quién" style="width: 8rem">
            <template #body="{ data }">{{ data.userName ?? '—' }}</template>
          </Column>
          <Column header="Importe" style="width: 8rem">
            <template #body="{ data }">
              <b class="pos-money" :class="data.kind === 'payment' ? 'cli-zero' : 'cli-debt'"
                >{{ data.kind === 'payment' ? '−' : '+' }}{{ eurCents(data.amountCents) }}</b
              >
            </template>
          </Column>
        </DataTable>
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
  flex-wrap: wrap;
}
.bo-spacer {
  flex: 1;
}
.bo-search {
  width: 260px;
  max-width: 40vw;
}
.bo-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  color: var(--pos-green-dark);
}
.bo-toggle--form {
  margin-top: 14px;
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
.cli-owed {
  font-size: 15px;
}
.cli-owed b {
  color: var(--pos-danger);
}
.cli-owed small {
  color: var(--pos-text-3);
}
.cli-sub {
  display: block;
  font-size: 12px;
  color: var(--pos-text-3);
}
.cli-sub-inline {
  color: var(--pos-text-2);
}
.cli-debt {
  color: var(--pos-danger);
}
.cli-zero {
  color: var(--pos-green-hover);
}
.cli-account-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 16px;
}
.cli-account-head b {
  font-size: 22px;
}
.cli-account-head small {
  color: var(--pos-text-3);
}
</style>
