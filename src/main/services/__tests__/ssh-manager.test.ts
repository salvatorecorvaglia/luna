import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ssh2', () => {
  return {
    Client: class {
      connect = vi.fn()
      on = vi.fn((event, cb) => {
        if (event === 'ready') setTimeout(cb, 10)
      })
      end = vi.fn()
      destroy = vi.fn()
      removeAllListeners = vi.fn()
    }
  }
})

vi.mock('../database', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({
        host: 'example.com',
        port: 22,
        username: 'user',
        auth_type: 'password'
      }),
      run: vi.fn()
    })
  }),
  getSetting: vi.fn().mockReturnValue(1000)
}))

vi.mock('../credential-store', () => ({
  retrieveCredential: vi.fn().mockReturnValue('password123')
}))

vi.mock('../host-key-store', () => ({
  verifyHostKey: vi.fn().mockReturnValue({ trusted: true, isFirst: false }),
  parseHostKeyAlgorithm: vi.fn().mockReturnValue('ssh-rsa')
}))

vi.mock('../emit', () => ({
  emitToRenderer: vi.fn()
}))

import { sshManager } from '../ssh-manager'

import { getDatabase } from '../database'

describe('sshManager', () => {
  beforeEach(() => {
    sshManager.disconnectAll()
  })

  it('testConnection should return ok for valid connection', async () => {
    const result = await sshManager.testConnection('conn-id-1')
    expect(result.ok).toBe(true)
  })

  it('testConnection should return error if connection not found', async () => {
    vi.mocked(getDatabase).mockReturnValueOnce({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined)
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const result = await sshManager.testConnection('invalid-id')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Connection not found')
  })
})
