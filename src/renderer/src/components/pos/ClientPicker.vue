<script setup lang="ts">
/**
 * Pick an "a cuenta" client: search by name/detail, see what each owes, or add a
 * new one on the spot (works offline). Used for credit sales, debt payments with
 * a purchase and the Clientes screen.
 */
import { computed, onMounted, ref } from 'vue'
import { useClientsStore } from '../../stores/clients'
import { usePosStore } from '../../stores/pos'
import { eur, initials } from '../../data/catalog'
import { fuzzySearch } from '../../utils/search'

const props = defineProps<{
  modelValue: string | null
  /** Only clients who owe something (to collect a debt). */
  debtorsOnly?: boolean
  /** Allow adding a new client. */
  allowCreate?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', id: string | null): void }>()

const clients = useClientsStore()
const pos = usePosStore()
const search = ref('')
const creating = ref(false)
const newName = ref('')
const newDetail = ref('')
const error = ref('')
const saving = ref(false)

onMounted(() => void clients.load())

const shown = computed(() => {
  const base = props.debtorsOnly
    ? clients.list.filter((c) => c.balanceCents > 0)
    : clients.list.filter((c) => c.active)
  return fuzzySearch(base, search.value, (c) => [c.name, c.detail ?? '']).slice(0, 60)
})

function startCreate(): void {
  creating.value = true
  newName.value = search.value.trim()
  newDetail.value = ''
  error.value = ''
}

async function create(): Promise<void> {
  if (!newName.value.trim()) {
    error.value = 'Indica el nombre.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const c = await clients.create(
      newName.value.trim(),
      newDetail.value.trim() || null,
      pos.actor()
    )
    creating.value = false
    search.value = ''
    emit('update:modelValue', c.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo crear el cliente.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="cp">
    <div v-if="!creating" class="cp-top">
      <span class="cp-search">
        <i class="pi pi-search"></i>
        <input v-model="search" placeholder="Buscar cliente (nombre, parcela…)" />
      </span>
      <button v-if="allowCreate" class="cp-new" @click="startCreate">
        <i class="pi pi-user-plus"></i> Nuevo cliente
      </button>
    </div>

    <div v-if="creating" class="cp-form">
      <label>Nombre</label>
      <InputText v-model="newName" placeholder="p. ej. Familia Müller" fluid />
      <label>Parcela / detalle <small>(opcional)</small></label>
      <InputText
        v-model="newDetail"
        placeholder="p. ej. Parcela 14"
        fluid
        @keydown.enter="create"
      />
      <span v-if="error" class="cp-error">{{ error }}</span>
      <div class="cp-form-actions">
        <button class="cp-btn" :disabled="saving" @click="creating = false">Cancelar</button>
        <button class="cp-btn cp-btn--ok" :disabled="saving" @click="create">
          {{ saving ? 'GUARDANDO…' : 'AÑADIR CLIENTE' }}
        </button>
      </div>
    </div>

    <div v-else class="cp-list">
      <div v-if="shown.length === 0" class="cp-empty">
        {{
          debtorsOnly
            ? 'Ningún cliente debe nada.'
            : search
              ? 'Sin resultados.'
              : 'Todavía no hay clientes.'
        }}
      </div>
      <button
        v-for="c in shown"
        :key="c.id"
        class="cp-item"
        :class="{ 'cp-item--on': modelValue === c.id }"
        @click="emit('update:modelValue', c.id)"
      >
        <span class="cp-avatar">{{ initials(c.name) }}</span>
        <span class="cp-text">
          <span class="cp-name">{{ c.name }}</span>
          <span v-if="c.detail" class="cp-detail">{{ c.detail }}</span>
        </span>
        <span class="cp-balance pos-money" :class="{ 'cp-balance--debt': c.balanceCents > 0 }">
          {{ c.balanceCents > 0 ? eur(c.balanceCents / 100) : 'Sin deuda' }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cp {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-top {
  display: flex;
  gap: 8px;
}
.cp-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 44px;
  border: 1.5px solid var(--pos-border-medium);
  border-radius: 10px;
  background: #fff;
}
.cp-search input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 15px;
  background: transparent;
}
.cp-new {
  height: 44px;
  padding: 0 14px;
  border-radius: 10px;
  background: var(--pos-green-soft);
  color: var(--pos-green-dark);
  font-weight: 800;
  white-space: nowrap;
}
.cp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.cp-empty {
  padding: 14px;
  color: var(--pos-text-3);
  font-weight: 600;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  min-height: 58px;
  border-radius: 12px;
  border: 2px solid var(--pos-border-subtle);
  background: #fff;
  text-align: left;
}
.cp-item--on {
  border-color: var(--pos-green);
  background: var(--pos-green-soft);
}
.cp-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--pos-green-dark);
  color: #fff;
  font-weight: 900;
  font-size: 13px;
  flex: 0 0 auto;
}
.cp-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.cp-name {
  font-weight: 800;
}
.cp-detail {
  font-size: 12px;
  color: var(--pos-text-3);
}
.cp-balance {
  font-weight: 800;
  color: var(--pos-text-3);
}
.cp-balance--debt {
  color: var(--pos-danger);
}
.cp-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cp-form label {
  font-size: 13px;
  font-weight: 800;
  color: var(--pos-text-2);
}
.cp-form small {
  font-weight: 600;
  color: var(--pos-text-3);
}
.cp-form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
}
.cp-btn {
  height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  background: #f4f7f9;
  font-weight: 800;
}
.cp-btn--ok {
  background: var(--pos-green);
  color: #fff;
}
.cp-error {
  color: var(--pos-danger);
  font-weight: 700;
  font-size: 13px;
}
</style>
