import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sshManager } from '../ssh-manager';

import { getDatabase } from '../database';

vi.mock('ssh2', () => {
  return {
    Client: class {
      connect = vi.fn();
      on = vi.fn((event, cb) => {
        if (event === 'ready') setTimeout(cb, 10);
      });
      // testConnection now uses once() + a 'close' handler so the promise
      // can settle on socket teardown without 'error'/'ready'.
      once = vi.fn((event, cb) => {
        if (event === 'ready') setTimeout(cb, 10);
      });
      off = vi.fn();
      end = vi.fn();
      destroy = vi.fn();
      removeAllListeners = vi.fn();
    },
  };
});

vi.mock('../database', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({
        provider: 'sftp',
        host: 'example.com',
        port: 22,
        username: 'user',
        auth_type: 'password',
      }),
      run: vi.fn(),
    }),
  }),
  getSetting: vi.fn().mockReturnValue(1000),
}));

vi.mock('../credential-store', () => ({
  retrieveCredential: vi.fn().mockReturnValue('password123'),
}));

vi.mock('../host-key-store', () => ({
  verifyHostKey: vi.fn().mockReturnValue({ trusted: true, isFirst: false }),
  parseHostKeyAlgorithm: vi.fn().mockReturnValue('ssh-rsa'),
  fingerprintKey: vi.fn().mockReturnValue('SHA256:test-fingerprint'),
  formatHostKey: vi.fn((host: string, port: number) => `${host}:${port}`),
  getStoredHostKey: vi.fn().mockReturnValue(null),
  updateHostKey: vi.fn(),
}));

vi.mock('../emit', () => ({
  emitToRenderer: vi.fn(),
}));

describe('sshManager', () => {
  beforeEach(() => {
    sshManager.disconnectAll();
  });

  it('testConnection should return ok for valid connection', async () => {
    const result = await sshManager.testConnection({ connectionId: 'conn-id-1' });
    expect(result.ok).toBe(true);
  });

  it('testConnection should return error if connection not found', async () => {
    vi.mocked(getDatabase).mockReturnValueOnce({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const result = await sshManager.testConnection({ connectionId: 'invalid-id' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection not found');
  });
});
