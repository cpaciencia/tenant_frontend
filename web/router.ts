import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@renderer/stores/auth'
import { navItems } from '@renderer/data/backoffice'

/*
 * Web router for the standalone backoffice. Real browser history. Login is
 * required; section access is gated by the same permission metadata the sidebar
 * uses (navItems), so the URL can't bypass the UI.
 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/backoffice' },
  { path: '/login', name: 'login', component: () => import('./LoginView.vue') },
  {
    path: '/backoffice/:section',
    name: 'backoffice',
    component: () => import('@renderer/views/BackofficeView.vue')
  },
  { path: '/backoffice', redirect: () => `/backoffice/${firstAllowedSection() ?? 'ventas'}` },
  // The shared BackofficeView has a "back to POS" button (router name 'caja');
  // there is no POS in the browser, so send it back to the dashboard.
  { path: '/caja', name: 'caja', redirect: '/backoffice' }
]

/** First section the current user may access (for redirects after login). */
function firstAllowedSection(): string | undefined {
  const auth = useAuthStore()
  return navItems.find((n) => !n.permissions || auth.canAny(n.permissions))?.id
}

export const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) await auth.restore()

  if (to.name === 'login') {
    return auth.isAuthenticated ? { path: '/' } : true
  }

  if (!auth.isAuthenticated) {
    return { name: 'login' }
  }

  // Gate each section by its declared permissions; bounce to the first allowed.
  if (to.name === 'backoffice') {
    const section = String(to.params.section)
    const item = navItems.find((n) => n.id === section)
    if (item?.permissions && !auth.canAny(item.permissions)) {
      const fallback = firstAllowedSection()
      return fallback ? { name: 'backoffice', params: { section: fallback } } : { name: 'login' }
    }
  }
  return true
})
