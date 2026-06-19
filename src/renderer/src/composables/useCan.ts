import { storeToRefs } from 'pinia'
import { useAuthStore } from '../stores/auth'

/**
 * Capability checks for templates/logic. Returns bound helpers plus the reactive
 * `permissions` ref, so `can(...)` used in a template re-evaluates when the
 * session changes. Prefer `v-if="can('stock:update')"` for show/hide.
 */
export function useCan() {
  const auth = useAuthStore()
  const { permissions } = storeToRefs(auth)
  return {
    permissions,
    can: (permission: string): boolean => auth.can(permission),
    canAny: (perms: string[]): boolean => auth.canAny(perms),
    canAll: (perms: string[]): boolean => auth.canAll(perms)
  }
}
