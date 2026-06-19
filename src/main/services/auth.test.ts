import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { createDatabase, type DB } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { upsertUsers } from '../repositories/users'
import { AuthService } from './auth'

let db: DB

/** A fetch that always fails — forces the offline path. */
const offlineFetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch

beforeEach(async () => {
  db = createDatabase(':memory:')
  await runMigrations(db)
  upsertUsers(db, [
    {
      id: '019ed000-0000-7000-8000-000000000001',
      username: 'cajero',
      passwordHash: bcrypt.hashSync('secret123', 10),
      fullName: 'Caja Uno',
      role: 'CASHIER',
      active: true,
      permissions: ['pos:sell', 'stock:read'],
      updatedAt: '2026-06-18T10:00:00.000Z'
    }
  ])
})

describe('AuthService offline login', () => {
  const service = (): AuthService =>
    new AuthService(db, () => 'http://localhost:8080', offlineFetch)

  it('returns user + effective permissions on correct credentials', async () => {
    const result = await service().login('cajero', 'secret123')
    expect(result.user.username).toBe('cajero')
    expect(result.user.role).toBe('CASHIER')
    expect(result.permissions).toEqual(['pos:sell', 'stock:read'])
    expect(result.token).toBeNull() // offline → no JWT
  })

  it('rejects a wrong password', async () => {
    await expect(service().login('cajero', 'wrong')).rejects.toThrow(/incorrectos/)
  })

  it('rejects an unknown user', async () => {
    await expect(service().login('ghost', 'secret123')).rejects.toThrow(/incorrectos/)
  })

  it('rejects an inactive user', async () => {
    upsertUsers(db, [
      {
        id: '019ed000-0000-7000-8000-000000000001',
        username: 'cajero',
        passwordHash: bcrypt.hashSync('secret123', 10),
        fullName: 'Caja Uno',
        role: 'CASHIER',
        active: false,
        permissions: ['pos:sell'],
        updatedAt: '2026-06-18T11:00:00.000Z'
      }
    ])
    await expect(service().login('cajero', 'secret123')).rejects.toThrow(/incorrectos/)
  })
})
