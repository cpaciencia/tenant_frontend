<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  listRoles,
  listPermissions,
  createRole,
  updateRole,
  deleteRole,
  type AdminRole,
  type CatalogPermission
} from '../../services/admin'
import { useCan } from '../../composables/useCan'

const { can } = useCan()

const roles = ref<AdminRole[]>([])
const permissions = ref<CatalogPermission[]>([])
const loading = ref(false)
const error = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const form = reactive({ name: '', description: '', selected: new Set<string>() })

/** Permissions grouped by resource (prefix before ':') for a tidy checkbox grid. */
const grouped = computed<Record<string, CatalogPermission[]>>(() => {
  const out: Record<string, CatalogPermission[]> = {}
  for (const p of permissions.value) {
    const resource = p.key.split(':')[0]
    ;(out[resource] ??= []).push(p)
  }
  return out
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[roles.value, permissions.value] = await Promise.all([listRoles(), listPermissions()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los roles'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = null
  form.name = ''
  form.description = ''
  form.selected = new Set()
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(role: AdminRole): void {
  editingId.value = role.id
  form.name = role.name
  form.description = role.description ?? ''
  form.selected = new Set(role.permissions)
  formError.value = ''
  dialogOpen.value = true
}

function toggle(key: string, checked: boolean): void {
  if (checked) form.selected.add(key)
  else form.selected.delete(key)
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
    description: form.description.trim() || undefined,
    permissions: [...form.selected]
  }
  try {
    if (editingId.value) await updateRole(editingId.value, body)
    else await createRole(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar el rol'
  } finally {
    saving.value = false
  }
}

async function remove(role: AdminRole): Promise<void> {
  if (!confirm(`¿Eliminar el rol "${role.name}"?`)) return
  try {
    await deleteRole(role.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo eliminar el rol'
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button v-if="can('role:manage')" label="Nuevo rol" icon="pi pi-plus" @click="openCreate" />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <DataTable :value="roles" :loading="loading" data-key="id" class="bo-card">
      <Column field="name" header="Rol" />
      <Column field="description" header="Descripción" />
      <Column header="Permisos">
        <template #body="{ data }">{{ data.permissions.length }}</template>
      </Column>
      <Column v-if="can('role:manage')" header="Acciones" style="width: 12rem">
        <template #body="{ data }">
          <Button label="Editar" text size="small" @click="openEdit(data)" />
          <Button label="Eliminar" severity="danger" text size="small" @click="remove(data)" />
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="dialogOpen"
      modal
      :header="editingId ? 'Editar rol' : 'Nuevo rol'"
      :style="{ width: '40rem' }"
    >
      <div class="bo-form">
        <label>Nombre</label>
        <InputText v-model="form.name" />
        <label>Descripción</label>
        <InputText v-model="form.description" />
        <label>Permisos</label>
        <div class="perm-grid">
          <div v-for="(perms, resource) in grouped" :key="resource" class="perm-group">
            <div class="perm-group__title">{{ resource }}</div>
            <div v-for="p in perms" :key="p.key" class="perm-row">
              <Checkbox
                :model-value="form.selected.has(p.key)"
                binary
                :input-id="p.key"
                @update:model-value="(v: boolean) => toggle(p.key, v)"
              />
              <label :for="p.key">{{ p.description }}</label>
            </div>
          </div>
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
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
}
.perm-group__title {
  font-weight: 800;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--pos-text-3);
  margin-bottom: 4px;
}
.perm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.perm-row label {
  font-size: 13px;
  margin: 0;
}
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
