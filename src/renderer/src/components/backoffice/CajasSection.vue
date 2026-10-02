<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  listAccountingGroups,
  createAccountingGroup,
  updateAccountingGroup,
  deleteAccountingGroup,
  type AdminAccountingGroup
} from '../../services/admin'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'

/**
 * CRUD for "cajas por categoría" (accounting groups): the cash buckets a category's
 * takings roll up into for the Z-report. Backend-owned, reached over HTTP (shared by
 * web and desktop). Read needs `accounting_group:read`; writes the matching perms.
 */
const { can } = useCan()

const groups = ref<AdminAccountingGroup[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const form = reactive({ code: '', name: '', active: true })

const filtered = computed<AdminAccountingGroup[]>(() =>
  fuzzySearch(groups.value, search.value, (g) => [g.code, g.name])
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    groups.value = await listAccountingGroups()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los grupos contables'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.code = ''
  form.name = ''
  form.active = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(group: AdminAccountingGroup): void {
  editingId.value = group.id
  form.code = group.code
  form.name = group.name
  form.active = group.active
  formError.value = ''
  dialogOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.code.trim() || !form.name.trim()) {
    formError.value = 'El código y el nombre son obligatorios'
    return
  }
  saving.value = true
  formError.value = ''
  const body = { code: form.code.trim(), name: form.name.trim(), active: form.active }
  try {
    if (editingId.value) await updateAccountingGroup(editingId.value, body)
    else await createAccountingGroup(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar el grupo contable'
  } finally {
    saving.value = false
  }
}

async function remove(group: AdminAccountingGroup): Promise<void> {
  if (!confirm(`¿Eliminar el grupo contable "${group.name}" (${group.code})?`)) return
  try {
    await deleteAccountingGroup(group.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo eliminar el grupo contable'
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button
        v-if="can('accounting_group:create')"
        label="Nuevo grupo"
        icon="pi pi-plus"
        @click="openCreate"
      />
      <span class="bo-spacer" />
      <InputText v-model="search" placeholder="Buscar por código o nombre…" class="bo-search" />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <DataTable :value="filtered" :loading="loading" data-key="id" class="bo-card">
      <template #empty>
        <div class="bo-empty">No hay grupos contables todavía.</div>
      </template>
      <Column field="code" header="Código" sortable style="width: 12rem" />
      <Column field="name" header="Nombre" sortable />
      <Column header="Estado" style="width: 8rem">
        <template #body="{ data }">
          <Tag
            :value="data.active ? 'Activa' : 'Inactiva'"
            :severity="data.active ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column
        v-if="can('accounting_group:update') || can('accounting_group:delete')"
        header="Acciones"
        style="width: 12rem"
      >
        <template #body="{ data }">
          <Button
            v-if="can('accounting_group:update')"
            label="Editar"
            text
            size="small"
            @click="openEdit(data)"
          />
          <Button
            v-if="can('accounting_group:delete')"
            label="Eliminar"
            severity="danger"
            text
            size="small"
            @click="remove(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editingId ? 'Editar grupo contable' : 'Nuevo grupo contable'"
      :style="{ width: '30rem' }"
    >
      <div class="bo-form">
        <label>Código</label>
        <InputText v-model="form.code" placeholder="p. ej. BARRA" />
        <label>Nombre</label>
        <InputText v-model="form.name" placeholder="p. ej. Barra / Bar" />
        <div class="bo-toggle">
          <ToggleSwitch v-model="form.active" />
          <span>{{ form.active ? 'Activa' : 'Inactiva' }}</span>
        </div>
        <span v-if="formError" class="bo-error">{{ formError }}</span>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="dialogOpen = false" />
        <Button label="Guardar" :loading="saving" @click="submit" />
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
.bo-search {
  width: 280px;
  max-width: 40vw;
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
.bo-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  font-weight: 700;
  font-size: 14px;
  color: var(--pos-green-dark);
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
</style>
