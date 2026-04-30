import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory shim of the subset of better-sqlite3 used by host-key-store.
// We avoid loading the native module here because its ABI is compiled for
// Electron's Node version, not the test runner's.
type Row = { host_key: string; algorithm: string; fingerprint: string; first_seen: number }
const table = new Map<string, Row>()

const fakeDb = {
  prepare(sql: string) {
    if (sql.startsWith('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')) {
      return {
        get: (hostKey: string) => {
          const row = table.get(hostKey)
          return row ? { fingerprint: row.fingerprint, algorithm: row.algorithm } : undefined
        }
      }
    }
    if (sql.includes('INSERT INTO known_hosts') && sql.includes('ON CONFLICT')) {
      return {
        run: (hostKey: string, algorithm: string, fingerprint: string) => {
          table.set(hostKey, { host_key: hostKey, algorithm, fingerprint, first_seen: 0 })
        }
      }
    }
    throw new Error(`Unexpected SQL: ${sql}`)
  }
}

vi.mock('../database', () => ({ getDatabase: () => fakeDb }))

import { verifyHostKey, updateHostKey } from '../host-key-store'

beforeEach(() => {
  table.clear()
})

describe('host-key-store TOFU', () => {
  it('signals first-use (untrusted) for a never-seen host', () => {
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-rsa')
    expect(result).toEqual({ trusted: false, changed: false, isFirst: true })
    // Should NOT auto-store — explicit trust via updateHostKey is required.
    expect(table.has('host:22')).toBe(false)
  })

  it('trusts the same key on subsequent encounters once stored', () => {
    updateHostKey('host', 22, Buffer.from('key-1'), 'ssh-rsa')
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-rsa')
    expect(result).toEqual({ trusted: true, changed: false, isFirst: false })
  })

  it('rejects when the key changes (possible MITM)', () => {
    updateHostKey('host', 22, Buffer.from('original'), 'ssh-rsa')
    const result = verifyHostKey('host', 22, Buffer.from('different'), 'ssh-rsa')
    expect(result).toEqual({ trusted: false, changed: true, isFirst: false })
  })

  it('updateHostKey overwrites the stored fingerprint', () => {
    updateHostKey('host', 22, Buffer.from('original'), 'ssh-rsa')
    updateHostKey('host', 22, Buffer.from('new-key'), 'ssh-rsa')
    const result = verifyHostKey('host', 22, Buffer.from('new-key'), 'ssh-rsa')
    expect(result.trusted).toBe(true)
  })

  it('treats different ports as different hosts', () => {
    updateHostKey('host', 22, Buffer.from('k22'), 'ssh-rsa')
    const onPort2222 = verifyHostKey('host', 2222, Buffer.from('k2222'), 'ssh-rsa')
    expect(onPort2222).toEqual({ trusted: false, changed: false, isFirst: true })
  })
})
