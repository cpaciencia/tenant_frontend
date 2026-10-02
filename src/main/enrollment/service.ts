import type { ConnectionTestResult, EnrollmentState, EnrollResult } from '../../shared/types'
import type { BootstrapConfig } from '../bootstrap/config'
import type { CredentialStore } from './store'
import { EnrollmentError, type EnrollmentClient, type IssuedCredentials } from './client'

/** Called once enrolment succeeds (e.g. to open the now-unlockable database). */
export type OnEnrolled = (credentials: IssuedCredentials) => void | Promise<void>

/**
 * Orchestrates terminal enrolment: connectivity probe, code redemption, and the
 * persistence of issued credentials (credential store) plus the backend URL
 * (bootstrap config). Deliberately free of any database dependency — it must run
 * BEFORE the encrypted DB can be opened, since the DB key comes from enrolment.
 */
export class EnrollmentService {
  constructor(
    private readonly bootstrap: BootstrapConfig,
    private readonly client: EnrollmentClient,
    private readonly store: CredentialStore,
    private readonly onEnrolled?: OnEnrolled
  ) {}

  getState(): EnrollmentState {
    const credentials = this.store.load()
    return {
      enrolled: credentials !== null,
      // Once enrolled, the terminal id is whatever the backend issued.
      terminalId: credentials?.terminalId ?? 'T01',
      syncApiUrl: this.bootstrap.getSyncApiUrl()
    }
  }

  async testConnection(syncApiUrl: string): Promise<ConnectionTestResult> {
    const reachable = await this.client.testConnection(syncApiUrl)
    return reachable
      ? { ok: true, message: 'Conexión correcta.' }
      : { ok: false, message: 'No se pudo conectar con el backend.' }
  }

  async enroll(syncApiUrl: string, terminalId: string, code: string): Promise<EnrollResult> {
    try {
      const issued = await this.client.enroll(syncApiUrl, terminalId, code)
      this.store.save(issued)
      this.bootstrap.setSyncApiUrl(syncApiUrl)
      // Bring up the DB-backed runtime (the key is now available).
      await this.onEnrolled?.(issued)
      return { ok: true, state: this.getState() }
    } catch (error) {
      const message =
        error instanceof EnrollmentError ? error.message : `Error inesperado: ${String(error)}`
      return { ok: false, message }
    }
  }

  /**
   * Change the backend URL WITHOUT re-enrolling. Persisted to the bootstrap config,
   * so it survives restarts and is picked up live by the (lazy) sync client, the
   * auth service and the next pulls. The terminal credentials and DB key are kept
   * — use this when the same backend just moved to a new address.
   */
  updateSyncApiUrl(syncApiUrl: string): EnrollmentState {
    this.bootstrap.setSyncApiUrl(syncApiUrl)
    return this.getState()
  }

  reset(): EnrollmentState {
    this.store.clear()
    return this.getState()
  }
}
