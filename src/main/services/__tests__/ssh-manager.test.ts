import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../database';
import { sshManager } from '../ssh-manager';

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
      shell = vi.fn();
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

  it('disconnectAll() snapshots keys so it does not skip sessions', () => {
    // Drive disconnectAll directly on a synthetic sessions Map. The bug it
    // guards against is "iterate this.sessions.keys() while disconnect()
    // mutates this.sessions", which would skip every other entry.
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const m = sshManager as unknown as {
      sessions: Map<string, unknown>;
      disconnect: (id: string) => void;
    };
    const seen: string[] = [];
    m.sessions = new Map(ids.map((id) => [id, { id }]));
    const origDisconnect = m.disconnect.bind(m);
    m.disconnect = (id: string) => {
      seen.push(id);
      m.sessions.delete(id); // mimic the real mutation
    };
    sshManager.disconnectAll();
    m.disconnect = origDisconnect;
    expect(seen.sort()).toEqual(ids);
  });

  it('cleans up the prior client when connect() reuses a sessionId', async () => {
    // Regression: a renderer-initiated double-connect for the same sessionId
    // used to overwrite the session entry without destroying the prior Client,
    // leaking its handshake listeners and socket and letting a delayed 'close'
    // from the abandoned client mark the new session disconnected.
    const removeAllListeners = vi.fn();
    const destroy = vi.fn();
    const shellClose = vi.fn();
    const m = sshManager as unknown as { sessions: Map<string, unknown> };
    m.sessions.set('dup-session', {
      id: 'dup-session',
      connectionId: 'conn-id-1',
      client: { removeAllListeners, destroy, end: vi.fn() },
      shell: { close: shellClose },
      status: 'connected',
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnecting: false,
      reconnectGen: 7,
    });

    // Fire connect; the cleanup branch runs synchronously before the first
    // await, so we can inspect the spies immediately without waiting for the
    // connect promise (which won't resolve in this minimal mock setup).
    void sshManager.connect('dup-session', 'conn-id-1');
    await Promise.resolve();

    expect(removeAllListeners).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(shellClose).toHaveBeenCalledTimes(1);
    // The new session should carry an incremented generation so any timers
    // captured from the prior session bail on stale state.
    const fresh = (m.sessions.get('dup-session') as { reconnectGen: number } | undefined)
      ?.reconnectGen;
    expect(fresh).toBe(8);
  });

  it('testConnection should return error if connection not found', async () => {
    vi.mocked(getDatabase).mockReturnValueOnce({
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
    } as unknown as ReturnType<typeof getDatabase>);
    const result = await sshManager.testConnection({ connectionId: 'invalid-id' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection not found');
  });
});
