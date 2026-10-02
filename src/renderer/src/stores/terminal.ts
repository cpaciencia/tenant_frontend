import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { EnrollmentState } from '../../../shared/types'

/**
 * Holds the terminal enrolment state, loaded once from the Main process. Drives
 * the setup-before-login routing: until the terminal is enrolled, the app can
 * only reach the setup screen.
 */
export const useTerminalStore = defineStore('terminal', () => {
  const loaded = ref(false)
  const enrolled = ref(false)
  const terminalId = ref('T01')
  const syncApiUrl = ref('http://localhost:7071')

  function apply(state: EnrollmentState): void {
    enrolled.value = state.enrolled
    terminalId.value = state.terminalId
    syncApiUrl.value = state.syncApiUrl
  }

  /** Fetch enrolment state from Main (idempotent; safe to call from the guard). */
  async function load(): Promise<void> {
    apply(await window.api.enrollment.getState())
    loaded.value = true
  }

  return { loaded, enrolled, terminalId, syncApiUrl, apply, load }
})
