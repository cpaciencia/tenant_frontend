<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { navItems, sectionTitles } from '../data/backoffice'
import VentasSection from '../components/backoffice/VentasSection.vue'
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
import ConfiguracionSection from '../components/backoffice/ConfiguracionSection.vue'
import { useAuthStore } from '../stores/auth'
import logoUrl from '../assets/img/logo.png'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const sections = {
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
  configuracion: ConfiguracionSection
}

// With a session, show only sections the user can access; without one (e.g. the
// desktop app before its login lands) fall back to showing everything.
const visibleNav = computed(() =>
  auth.isAuthenticated
    ? navItems.filter((n) => !n.permissions || auth.canAny(n.permissions))
    : navItems
)

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
        <button
          v-for="n in visibleNav"
          :key="n.id"
          class="bo__nav-item"
          :class="{ 'bo__nav-item--active': section === n.id }"
          @click="go(n.id)"
        >
          <i class="pi bo__nav-icon" :class="n.icon"></i> {{ n.label }}
        </button>
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
  gap: 4px;
  flex: 1;
}
.bo__nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
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
