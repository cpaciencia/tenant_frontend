import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '../stores/auth'

/**
 * Shared route-permission helpers. A route declares required permissions in its
 * meta: `meta: { permissions: ['user:read'] }` (satisfied if the user has ANY of
 * them). Each target wires these into its own router guard, since the redirect
 * target on failure differs (web vs desktop login flow).
 */
export function routePermissions(to: RouteLocationNormalized): string[] {
  const meta = to.meta?.permissions
  return Array.isArray(meta) ? (meta as string[]) : []
}

export function hasRoutePermission(to: RouteLocationNormalized): boolean {
  const required = routePermissions(to)
  if (required.length === 0) return true
  return useAuthStore().canAny(required)
}
