import type { Directive, DirectiveBinding } from 'vue'
import { useAuthStore } from '../stores/auth'

/**
 * `v-can="'stock:update'"` or `v-can="['a','b']"` hides the element unless the
 * user has the permission(s). `v-can.all` requires all listed; default is any.
 * A convenience for simple cases; for reactive show/hide during a session prefer
 * `v-if="can('...')"` (see {@link useCan}).
 */
function apply(el: HTMLElement, binding: DirectiveBinding): void {
  const auth = useAuthStore()
  const perms = Array.isArray(binding.value) ? binding.value : [binding.value]
  const ok = binding.modifiers.all ? auth.canAll(perms) : auth.canAny(perms)
  el.style.display = ok ? '' : 'none'
}

export const vCan: Directive = {
  mounted: apply,
  updated: apply
}
