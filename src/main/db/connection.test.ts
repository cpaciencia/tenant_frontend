import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createDatabase } from './connection'

const created: string[] = []

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pos-enc-'))
  created.push(dir)
  return join(dir, 'test.db')
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('encrypted database', () => {
  it('round-trips with the correct key and leaves no plaintext on disk', () => {
    const path = tmpDbPath()
    const marker = 'SUPER-SECRET-MARKER-12345'

    const db = createDatabase(path, 'key-one')
    db.exec('CREATE TABLE t (v TEXT)')
    db.prepare('INSERT INTO t (v) VALUES (?)').run(marker)
    db.close()

    // Reopening with the same key reads the data back.
    const reopened = createDatabase(path, 'key-one')
    expect((reopened.prepare('SELECT v FROM t').get() as { v: string }).v).toBe(marker)
    reopened.close()

    // The raw file is ciphertext: the plaintext marker must not appear.
    expect(readFileSync(path).includes(Buffer.from(marker))).toBe(false)
  })

  it('refuses to open with the wrong key', () => {
    const path = tmpDbPath()
    const db = createDatabase(path, 'right-key')
    db.exec('CREATE TABLE t (v TEXT)')
    db.close()

    // The wrong key fails as soon as the header is read (the WAL pragma).
    expect(() => createDatabase(path, 'wrong-key')).toThrow()
  })

  it('still works unencrypted for in-memory test databases (no key)', () => {
    const db = createDatabase(':memory:')
    db.exec('CREATE TABLE t (v INTEGER)')
    db.prepare('INSERT INTO t (v) VALUES (1)').run()
    expect((db.prepare('SELECT v FROM t').get() as { v: number }).v).toBe(1)
    db.close()
  })
})