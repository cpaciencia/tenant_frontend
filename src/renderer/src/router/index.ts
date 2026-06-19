import { createRouter, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTerminalStore } from '../stores/terminal'
import { navItems } from '../data/backoffice'

/*
 * Memory history (not hash/web) on purpose: this is a desktop app where the URL
 * is never shown or reloaded, and a hash router would collide with the
 * `#customer` hash the Main process uses to open the customer-display window.
 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/login' },
  {
    path: '/setup',
    name: 'setup',
    component: () => import('../views/SetupView.vue')
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/caja',
    name: 'caja',
    component: () => import('../views/PosView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/backoffice/:section',
    name: 'backoffice',
    component: () => import('../views/BackofficeView.vue'),
    meta: { requiresAuth: true }
  },
  { path: '/backoffice', redirect: '/backoffice/ventas' }
]

export const router = createRouter({
  history: createMemoryHistory(),
  routes
})

// Guard order: enrolment first (setup-before-login), then the session.
router.beforeEach(async (to) => {
  const terminal = useTerminalStore()
  if (!terminal.loaded) await terminal.load()

  // Not enrolled yet → the only reachable screen is setup.
  if (!terminal.enrolled) return to.name === 'setup' ? true : { name: 'setup' }
  // Enrolled → setup is no longer an entry point.
  if (to.name === 'setup') return { name: 'login' }

  const auth = useAuthStore()
  // Restore a persisted session once (so a valid token goes straight to the till
  // and the backoffice without a fresh login).
  if (!auth.ready) await auth.restore()
  if (to.meta.requiresAuth && !auth.isAuthenticated) return { name: 'login' }
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'caja' }

  // Gate backoffice sections by permission (same rule as the web). A user with no
  // access to the requested section is bounced to the first one they can open, or
  // back to the till if none.
  if (to.name === 'backoffice' && auth.isAuthenticated) {
    const item = navItems.find((n) => n.id === String(to.params.section))
    if (item?.permissions && !auth.canAny(item.permissions)) {
      const fallback = navItems.find((n) => !n.permissions || auth.canAny(n.permissions))
      return fallback
        ? { name: 'backoffice', params: { section: fallback.id } }
        : { name: 'caja' }
    }
  }
  return true
})
