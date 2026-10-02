<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import {
  listUsers,
  listRoles,
  createUser,
  deactivateUser,
  type AdminUser,
  type AdminRole
} from '../../services/admin'
import { useCan } from '../../composables/useCan'

const { can } = useCan()

const users = ref<AdminUser[]>([])
const roles = ref<AdminRole[]>([])
const loading = ref(false)
const error = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({ username: '', password: '', fullName: '', roleId: '' as string })

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[users.value, roles.value] = await Promise.all([listUsers(), listRoles()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar los usuarios'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  form.username = ''
  form.password = ''
  form.fullName = ''
  form.roleId = roles.value[0]?.id ?? ''
  formError.value = ''
  dialogOpen.value = true
}

async function submit(): Promise<void> {
  if (!form.username.trim() || !form.password.trim()) {
    formError.value = 'Usuario y contraseña son obligatorios'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await createUser({
      username: form.username.trim(),
      password: form.password,
      fullName: form.fullName.trim() || undefined,
      roleId: form.roleId || undefined
    })
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo crear el usuario'
  } finally {
    saving.value = false
  }
}

async function deactivate(u: AdminUser): Promise<void> {
  if (!confirm(`¿Dar de baja a ${u.username}?`)) return
  try {
    await deactivateUser(u.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo dar de baja'
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button
        v-if="can('user:create')"
        label="Nuevo usuario"
        icon="pi pi-plus"
        @click="openCreate"
      />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <DataTable :value="users" :loading="loading" data-key="id" class="bo-card">
      <Column field="username" header="Usuario" />
      <Column field="fullName" header="Nombre" />
      <Column field="roleName" header="Rol" />
      <Column header="Estado">
        <template #body="{ data }">
          <Tag
            :severity="data.active ? 'success' : 'secondary'"
            :value="data.active ? 'Activo' : 'Baja'"
          />
        </template>
      </Column>
      <Column v-if="can('user:deactivate')" header="Acciones" style="width: 8rem">
        <template #body="{ data }">
          <Button
            v-if="data.active"
            label="Baja"
            severity="danger"
            text
            size="small"
            @click="deactivate(data)"
          />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="dialogOpen" modal header="Nuevo usuario" :style="{ width: '26rem' }">
      <div class="bo-form">
        <label>Usuario</label>
        <InputText v-model="form.username" autocomplete="off" />
        <label>Contraseña</label>
        <Password v-model="form.password" :feedback="false" toggle-mask fluid />
        <label>Nombre completo</label>
        <InputText v-model="form.fullName" />
        <label>Rol</label>
        <Select
          v-model="form.roleId"
          :options="roles"
          option-label="name"
          option-value="id"
          placeholder="Selecciona un rol"
        />
        <span v-if="formError" class="bo-error">{{ formError }}</span>
      </div>
      <template #footer>
        <Button label="Cancelar" text @click="dialogOpen = false" />
        <Button label="Crear" :loading="saving" @click="submit" />
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
.bo-error {
  color: #dc2626;
  font-weight: 600;
  font-size: 13px;
}
</style>
