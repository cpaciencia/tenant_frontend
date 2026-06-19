import { describe, it, expect } from 'vitest'
import { createInMemoryBootstrapConfig } from '../bootstrap/config'
import { EnrollmentService } from './service'
import { createInMemoryCredentialStore } from './store'
import { EnrollmentError, type EnrollmentClient, type IssuedCredentials } from './client'

function fakeClient(overrides: Partial<EnrollmentClient> = {}): EnrollmentClient {
  return {
    enroll: async (): Promise<IssuedCredentials> => ({
      terminalId: 'T05',
      token: 'tok',
      dbKey: 'key'
    }),
    testConnection: async () => true,
    ...overrides
  }
}

describe('enrollment service', () => {
  it('reports not-enrolled with the default URL before enrolment', () => {
    const service = new EnrollmentService(
      createInMemoryBootstrapConfig(),
      fakeClient(),
      createInMemoryCredentialStore()
    )
    const state = service.getState()
    expect(state.enrolled).toBe(false)
    expect(state.syncApiUrl).toBe('http://localhost:8080')
  })

  it('stores credentials, persists the URL, and runs the onEnrolled hook', async () => {
    const store = createInMemoryCredentialStore()
    const bootstrap = createInMemoryBootstrapConfig()
    let unlockedKey: string | null = null
    const service = new EnrollmentService(bootstrap, fakeClient(), store, (c) => {
      unlockedKey = c.dbKey
    })

    const result = await service.enroll('http://server:9000/', 'T01', 'ABCD2345')

    expect(result.ok).toBe(true)
    expect(store.load()).toEqual({ terminalId: 'T05', token: 'tok', dbKey: 'key' })
    // URL persisted with the trailing slash stripped; runtime unlocked with the key.
    expect(bootstrap.getSyncApiUrl()).toBe('http://server:9000')
    expect(unlockedKey).toBe('key')
    // State reflects the backend-confirmed terminal id (T05), not the typed one.
    expect(service.getState().enrolled).toBe(true)
    expect(service.getState().terminalId).toBe('T05')
  })

  it('returns the error message and stays unenrolled on failure', async () => {
    const store = createInMemoryCredentialStore()
    let hookCalled = false
    const client = fakeClient({
      enroll: async () => {
        throw new EnrollmentError('Código o terminal incorrectos.', 401)
      }
    })
    const service = new EnrollmentService(
      createInMemoryBootstrapConfig(),
      client,
      store,
      () => {
        hookCalled = true
      }
    )

    const result = await service.enroll('http://h', 'T01', 'WRONG')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('incorrectos')
    expect(store.load()).toBeNull()
    expect(hookCalled).toBe(false)
    expect(service.getState().enrolled).toBe(false)
  })

  it('reset forgets the stored credentials', async () => {
    const store = createInMemoryCredentialStore()
    const service = new EnrollmentService(createInMemoryBootstrapConfig(), fakeClient(), store)
    await service.enroll('http://h', 'T01', 'ABCD2345')

    const state = service.reset()

    expect(state.enrolled).toBe(false)
    expect(store.load()).toBeNull()
  })
})