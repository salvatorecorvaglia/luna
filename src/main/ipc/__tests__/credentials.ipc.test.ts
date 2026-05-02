import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

const store = vi.fn()
const retrieve = vi.fn().mockReturnValue('secret')
const del = vi.fn()
vi.mock('../../services/credential-store', () => ({
  storeCredential: (...a: unknown[]) => store(...a),
  retrieveCredential: (...a: unknown[]) => retrieve(...a),
  deleteCredential: (...a: unknown[]) => del(...a)
}))

vi.mock('../../lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

import { registerCredentialHandlers } from '../credentials.ipc'
import { IPC } from '@shared/constants'

beforeEach(() => {
  handlers.clear()
  store.mockClear()
  retrieve.mockClear()
  del.mockClear()
  registerCredentialHandlers()
})

describe('credentials IPC', () => {
  it('rejects empty connectionId on store', () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!
    expect(() => handler({}, { connectionId: '', secret: 's' })).toThrow(/connectionId/)
    expect(store).not.toHaveBeenCalled()
  })

  it('rejects empty secret on store', () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!
    expect(() => handler({}, { connectionId: 'id', secret: '' })).toThrow(/secret/)
    expect(store).not.toHaveBeenCalled()
  })

  it('rejects null-byte connectionId on store', () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!
    expect(() => handler({}, { connectionId: 'id\0evil', secret: 's' })).toThrow(/null byte/)
  })

  it('forwards valid input to storeCredential', () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!
    handler({}, { connectionId: 'abc', secret: 'shh' })
    expect(store).toHaveBeenCalledWith('abc', 'shh')
  })

  it('rejects empty connectionId on retrieve and delete', () => {
    expect(() => handlers.get(IPC.CREDENTIAL_RETRIEVE)!({}, '')).toThrow(/connectionId/)
    expect(() => handlers.get(IPC.CREDENTIAL_DELETE)!({}, '')).toThrow(/connectionId/)
  })

  it('returns retrieve result for valid input', () => {
    const result = handlers.get(IPC.CREDENTIAL_RETRIEVE)!({}, 'abc')
    expect(result).toBe('secret')
    expect(retrieve).toHaveBeenCalledWith('abc')
  })
})
