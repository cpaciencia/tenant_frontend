<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listAccountingGroups,
  type AdminCategory,
  type AdminAccountingGroup
} from '../../services/admin'
import { useCan } from '../../composables/useCan'
import { fuzzySearch } from '../../utils/search'

/**
 * CRUD for product categories: a two-level tree (category → optional subcategory),
 * each mapped to a "caja por categoría" (accounting group). Backend-owned, reached
 * over HTTP (shared by web and desktop). Read needs `category:read`; writes the
 * matching perms. Picking a parent pre-fills its caja (still editable).
 */
const { can } = useCan()

const categories = ref<AdminCategory[]>([])
const groups = ref<AdminAccountingGroup[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')

const dialogOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const hydrating = ref(false)
const form = reactive({
  name: '',
  parentId: null as string | null,
  accountingGroupId: null as string | null,
  color: '#27ae60',
  icon: '',
  active: true
})

const groupById = computed(() => new Map(groups.value.map((g) => [g.id, g])))

/** Flatten into display rows: each top-level category followed by its children. */
interface Row extends AdminCategory {
  depth: number
}
const rows = computed<Row[]>(() => {
  const tops = categories.value
    .filter((c) => !c.parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
  const out: Row[] = []
  for (const top of tops) {
    out.push({ ...top, depth: 0 })
    categories.value
      .filter((c) => c.parentId === top.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((child) => out.push({ ...child, depth: 1 }))
  }
  return out
})

const filtered = computed<Row[]>(() => fuzzySearch(rows.value, search.value, (r) => [r.name]))

/** Valid parents: top-level categories only, never the category being edited. */
const parentOptions = computed(() =>
  categories.value.filter((c) => !c.parentId && c.id !== editingId.value)
)

/** A category that already has subcategories can't become a subcategory itself. */
const hasChildren = computed(
  () => !!editingId.value && categories.value.some((c) => c.parentId === editingId.value)
)

const groupOptions = computed(() =>
  groups.value
    .filter((g) => g.active || g.id === form.accountingGroupId)
    .map((g) => ({ id: g.id, label: `${g.code} · ${g.name}` }))
)

function cajaCode(id: string): string {
  return groupById.value.get(id)?.code ?? '—'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    ;[categories.value, groups.value] = await Promise.all([
      listCategories(),
      listAccountingGroups()
    ])
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudieron cargar las categorías'
  } finally {
    loading.value = false
  }
}

async function hydrate(values: Partial<typeof form>): Promise<void> {
  hydrating.value = true
  Object.assign(form, values)
  // Let the parentId watcher skip this programmatic change.
  await nextTick()
  hydrating.value = false
}

function openCreate(): void {
  editingId.value = null
  formError.value = ''
  hydrate({
    name: '',
    parentId: null,
    accountingGroupId: null,
    color: '#27ae60',
    icon: '',
    active: true
  })
  dialogOpen.value = true
}

function openEdit(category: AdminCategory): void {
  editingId.value = category.id
  formError.value = ''
  hydrate({
    name: category.name,
    parentId: category.parentId,
    accountingGroupId: category.accountingGroupId,
    color: category.color ?? '#27ae60',
    icon: category.icon ?? '',
    active: category.active
  })
  dialogOpen.value = true
}

// Picking a parent pre-fills its caja (the user can still change it afterwards).
watch(
  () => form.parentId,
  (parentId) => {
    if (hydrating.value || !parentId) return
    const parent = categories.value.find((c) => c.id === parentId)
    if (parent) form.accountingGroupId = parent.accountingGroupId
  }
)

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    formError.value = 'El nombre es obligatorio'
    return
  }
  if (!form.accountingGroupId) {
    formError.value = 'La caja por categoría es obligatoria'
    return
  }
  saving.value = true
  formError.value = ''
  const body = {
    name: form.name.trim(),
    parentId: form.parentId,
    accountingGroupId: form.accountingGroupId,
    color: form.color,
    icon: form.icon.trim() || null,
    active: form.active
  }
  try {
    if (editingId.value) await updateCategory(editingId.value, body)
    else await createCategory(body)
    dialogOpen.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'No se pudo guardar la categoría'
  } finally {
    saving.value = false
  }
}

async function remove(category: AdminCategory): Promise<void> {
  if (!confirm(`¿Eliminar la categoría "${category.name}"?`)) return
  try {
    await deleteCategory(category.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo eliminar la categoría'
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="bo-toolbar">
      <Button
        v-if="can('category:create')"
        label="Nueva categoría"
        icon="pi pi-plus"
        :disabled="groups.length === 0"
        @click="openCreate"
      />
      <span class="bo-spacer" />
      <InputText v-model="search" placeholder="Buscar categoría…" class="bo-search" />
      <span v-if="error" class="bo-error">{{ error }}</span>
    </div>

    <p v-if="groups.length === 0 && !loading" class="bo-hint">
      Crea primero una <strong>Caja por categoría</strong>: cada categoría debe asociarse a una.
    </p>

    <DataTable :value="filtered" :loading="loading" data-key="id" class="bo-card">
      <template #empty>
        <div class="bo-empty">No hay categorías todavía.</div>
      </template>
      <Column header="Categoría">
        <template #body="{ data }">
          <span class="cat-name" :class="{ 'cat-name--child': data.depth === 1 }">
            <i v-if="data.depth === 1" class="pi pi-arrow-right cat-arrow"></i>
            <span class="cat-dot" :style="{ background: data.color || '#27ae60' }"></span>
            <i v-if="data.icon" class="pi" :class="data.icon"></i>
            {{ data.name }}
          </span>
        </template>
      </Column>
      <Column header="Caja" style="width: 12rem">
        <template #body="{ data }">{{ cajaCode(data.accountingGroupId) }}</template>
      </Column>
      <Column header="Estado" style="width: 8rem">
        <template #body="{ data }">
          <Tag
            :value="data.active ? 'Activa' : 'Inactiva'"
            :severity="data.active ? 'success' : 'secondary'"
          />
        </template>
      </Column>
      <Column
        v-if="can('category:update') || can('category:delete')"
        header="Acciones"
        style="width: 12rem"
      >
        <template #body="{ data }">
          <Button
            v-if="can('category:update')"
            label="Editar"
            text
            size="small"
            @click="openEdit(data)"
          />
          <Button
            v-if="can('category:delete')"
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
      :header="editingId ? 'Editar categoría' : 'Nueva categoría'"
      :style="{ width: '34rem' }"
    >
      <div class="bo-form">
        <label>Nombre</label>
        <InputText v-model="form.name" placeholder="p. ej. Bebidas" />

        <label>Categoría madre</label>
        <Select
          v-model="form.parentId"
          :options="parentOptions"
          option-label="name"
          option-value="id"
          placeholder="— Ninguna (categoría principal)"
          show-clear
          :disabled="hasChildren"
        />
        <small v-if="hasChildren" class="bo-note">
          Esta categoría tiene subcategorías, por eso no puede depender de otra.
        </small>

        <label>Caja por categoría</label>
        <Select
          v-model="form.accountingGroupId"
          :options="groupOptions"
          option-label="label"
          option-value="id"
          placeholder="Selecciona una caja"
        />

        <div class="bo-grid2">
          <div>
            <label>Color</label>
            <input v-model="form.color" type="color" class="cat-color" />
          </div>
          <div>
            <label>Icono (opcional)</label>
            <InputText v-model="form.icon" placeholder="pi-bolt" />
          </div>
        </div>

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
.bo-hint {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  color: #9a3412;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}
.cat-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--pos-green-dark);
}
.cat-name--child {
  padding-left: 22px;
  font-weight: 600;
  color: var(--pos-text-2);
}
.cat-arrow {
  font-size: 11px;
  color: var(--pos-text-3);
}
.cat-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
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
.bo-grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.cat-color {
  width: 100%;
  height: 38px;
  border: 1px solid var(--pos-border-medium);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
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
.bo-note {
  font-size: 12px;
  color: var(--pos-text-3);
  font-weight: 600;
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
