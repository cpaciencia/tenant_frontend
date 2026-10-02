<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { navGroups, navItems, sectionTitles, type NavGroupId } from '../data/backoffice'
import VentasSection from '../components/backoffice/VentasSection.vue'
import ResumenSection from '../components/backoffice/ResumenSection.vue'
import ActividadSection from '../components/backoffice/ActividadSection.vue'
import TicketsSection from '../components/backoffice/TicketsSection.vue'
import FacturasSection from '../components/backoffice/FacturasSection.vue'
import ProveedoresSection from '../components/backoffice/ProveedoresSection.vue'
import ProductosSection from '../components/backoffice/ProductosSection.vue'
import CategoriasSection from '../components/backoffice/CategoriasSection.vue'
import CajasSection from '../components/backoffice/CajasSection.vue'
import UsuariosSection from '../components/backoffice/UsuariosSection.vue'
import RolesSection from '../components/backoffice/RolesSection.vue'
import StockSection from '../components/backoffice/StockSection.vue'
import ClientesSection from '../components/backoffice/ClientesSection.vue'
import ConsumoInternoSection from '../components/backoffice/ConsumoInternoSection.vue'
import ConfiguracionSection from '../components/backoffice/ConfiguracionSection.vue'
import PuestosSection from '../components/backoffice/PuestosSection.vue'
import { useAuthStore } from '../stores/auth'
import logoUrl from '../assets/img/logo.png'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const sections = {
  resumen: ResumenSection,
  ventas: VentasSection,
  actividad: ActividadSection,
  tickets: TicketsSection,
  facturas: FacturasSection,
  proveedores: ProveedoresSection,
  productos: ProductosSection,
  categorias: CategoriasSection,
  cajas: CajasSection,
  usuarios: UsuariosSection,
  roles: RolesSection,
  stock: StockSection,
  clientes: ClientesSection,
  consumo: ConsumoInternoSection,
  puestos: PuestosSection,
  configuracion: ConfiguracionSection
}

// With a session, show only sections the user can access; without one (e.g. the
// desktop app before its login lands) fall back to showing everything.
const visibleNav = computed(() =>
  auth.isAuthenticated
    ? navItems.filter((n) => !n.permissions || auth.canAny(n.permissions))
    : navItems
)

/** Sidebar groups with their visible items (empty groups hidden). */
const visibleGroups = computed(() =>
  navGroups
    .map((g) => ({ ...g, items: visibleNav.value.filter((n) => n.group === g.id) }))
    .filter((g) => g.items.length > 0)
)

// Collapsed groups are a per-viewer convenience (browser storage, may be unavailable).
const COLLAPSED_KEY = 'backoffice.collapsedGroups'
function readCollapsed(): NavGroupId[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    return raw ? (JSON.parse(raw) as NavGroupId[]) : []
  } catch {
    return []
  }
}
const collapsed = ref<NavGroupId[]>(readCollapsed())

function toggleGroup(id: NavGroupId): void {
  collapsed.value = collapsed.value.includes(id)
    ? collapsed.value.filter((g) => g !== id)
    : [...collapsed.value, id]
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed.value))
  } catch {
    // storage unavailable: the toggle still works for this session
  }
}

/** The group holding the open section is always shown expanded. */
function isOpen(group: { id: NavGroupId; items: { id: string }[] }): boolean {
  return !collapsed.value.includes(group.id) || group.items.some((n) => n.id === section.value)
}

const section = computed(() => {
  const s = String(route.params.section)
  return s in sections ? (s as keyof typeof sections) : 'ventas'
})
const activeComponent = computed(() => sections[section.value])
const crumb = computed(() => sectionTitles[section.value][0])
const title = computed(() => sectionTitles[section.value][1])

function go(id: string): void {
  router.push({ name: 'backoffice', params: { section: id } })
}
function goPos(): void {
  router.push({ name: 'caja' })
}
</script>

<template>
  <div class="bo">
    <!-- Sidebar -->
    <aside class="bo__side">
      <div class="bo__logo-row">
        <img :src="logoUrl" class="bo__logo" alt="" />
        <div class="bo__logo-text">
          <div class="bo__logo-title">Backoffice</div>
          <div class="bo__logo-sub">PARQUE TROPICAL</div>
        </div>
      </div>
      <nav class="bo__nav">
        <template v-for="g in visibleGroups" :key="g.id">
          <!-- A group with one item: show the item directly. -->
          <button
            v-if="g.items.length === 1"
            class="bo__nav-item"
            :class="{ 'bo__nav-item--active': section === g.items[0].id }"
            @click="go(g.items[0].id)"
          >
            <i class="pi bo__nav-icon" :class="g.items[0].icon"></i> {{ g.items[0].label }}
          </button>
          <div v-else class="bo__group">
            <button class="bo__group-head" :aria-expanded="isOpen(g)" @click="toggleGroup(g.id)">
              <span>{{ g.label }}</span>
              <i class="pi" :class="isOpen(g) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
            </button>
            <template v-if="isOpen(g)">
              <button
                v-for="n in g.items"
                :key="n.id"
                class="bo__nav-item"
                :class="{ 'bo__nav-item--active': section === n.id }"
                @click="go(n.id)"
              >
                <i class="pi bo__nav-icon" :class="n.icon"></i> {{ n.label }}
              </button>
            </template>
          </div>
        </template>
      </nav>
      <button class="bo__back" @click="goPos">
        <i class="pi pi-shopping-cart bo__nav-icon"></i> Volver a la caja
      </button>
    </aside>

    <!-- Content -->
    <div class="bo__content">
      <div class="bo__header">
        <div class="bo__crumb">{{ crumb }}</div>
        <div class="bo__title">{{ title }}</div>
      </div>
      <div class="bo__body">
        <component :is="activeComponent" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bo {
  position: absolute;
  inset: 0;
  display: flex;
  background: #eef2f5;
}
.bo__side {
  flex: 0 0 248px;
  background: var(--pos-green-dark);
  display: flex;
  flex-direction: column;
  padding: 18px 14px;
}
.bo__logo-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 8px 20px;
}
.bo__logo {
  width: 40px;
  height: 40px;
  object-fit: contain;
  background: #fff;
  border-radius: 50%;
  padding: 4px;
}
.bo__logo-text {
  color: #fff;
  line-height: 1.1;
}
.bo__logo-title {
  font-weight: 900;
  font-size: 14px;
}
.bo__logo-sub {
  font-size: 11px;
  color: #7fae8f;
  letter-spacing: 0.04em;
}
.bo__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 10px;
}
.bo__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}
.bo__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 4px;
  background: transparent;
  color: #6f9a80;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.bo__group-head:hover {
  color: #fff;
}
.bo__group-head .pi {
  font-size: 10px;
}
.bo__nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  background: transparent;
  color: #9bbfa9;
  transition: all 0.12s ease;
}
.bo__nav-item:hover {
  color: #fff;
}
.bo__nav-item--active {
  background: rgba(39, 174, 96, 0.18);
  color: #fff;
}
.bo__nav-icon {
  width: 20px;
  text-align: center;
}
.bo__back {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  background: var(--pos-green);
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  border-radius: 11px;
  transition: background 0.12s ease;
}
.bo__back:hover {
  background: var(--pos-green-hover);
}
.bo__content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.bo__header {
  flex: 0 0 auto;
  padding: 26px 34px 18px;
  background: #fff;
  border-bottom: 1px solid var(--pos-border-medium);
}
.bo__crumb {
  font-size: 13px;
  color: var(--pos-text-3);
  font-weight: 700;
  letter-spacing: 0.05em;
}
.bo__title {
  font-size: 27px;
  font-weight: 900;
  color: var(--pos-green-dark);
  margin-top: 2px;
}
.bo__body {
  flex: 1;
  overflow-y: auto;
  padding: 28px 34px;
}
</style>
