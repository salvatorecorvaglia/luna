import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCredentialHandlers } from '../../../src/main/ipc/credentials.ipc';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

const store = vi.fn();
const retrieve = vi.fn().mockReturnValue('secret');
const del = vi.fn();
vi.mock('../../../src/main/services/credential-store', () => ({
  storeCredential: (...a: unknown[]) => store(...a),
  retrieveCredential: (...a: unknown[]) => retrieve(...a),
  deleteCredential: (...a: unknown[]) => del(...a),
  onCredentialTamper: () => () => {},
}));

vi.mock('../../../src/main/ipc/app.ipc', () => ({
  getMainWindow: () => null,
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  handlers.clear();
  store.mockClear();
  retrieve.mockClear();
  del.mockClear();
  registerCredentialHandlers();
});

describe('credentials IPC', () => {
  it('rejects empty connectionId on store', async () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!;
    await expect(handler({}, { connectionId: '', secret: 's' })).rejects.toThrow(/connectionId/);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects empty secret on store', async () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!;
    await expect(handler({}, { connectionId: 'id', secret: '' })).rejects.toThrow(/secret/);
    expect(store).not.toHaveBeenCalled();
  });

  it('rejects null-byte connectionId on store', async () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!;
    await expect(handler({}, { connectionId: 'id\0evil', secret: 's' })).rejects.toThrow(
      /null byte/,
    );
  });

  it('forwards valid input to storeCredential', async () => {
    const handler = handlers.get(IPC.CREDENTIAL_STORE)!;
    await handler({}, { connectionId: 'abc', secret: 'shh' });
    expect(store).toHaveBeenCalledWith('abc', 'shh');
  });

  it('rejects empty connectionId on retrieve and delete', async () => {
    await expect(handlers.get(IPC.CREDENTIAL_RETRIEVE)!({}, '')).rejects.toThrow(/connectionId/);
    await expect(handlers.get(IPC.CREDENTIAL_DELETE)!({}, '')).rejects.toThrow(/connectionId/);
  });

  it('returns retrieve result for valid input', async () => {
    const result = await handlers.get(IPC.CREDENTIAL_RETRIEVE)!({}, 'abc');
    expect(result).toBe('secret');
    expect(retrieve).toHaveBeenCalledWith('abc');
  });

  describe('byte-length cap', () => {
    const handler = (): ((...a: unknown[]) => unknown) => handlers.get(IPC.CREDENTIAL_STORE)!;

    it('accepts a secret whose char count exceeds the cap but whose byte length is under', async () => {
      // 4-byte emoji × 10000 chars = 40000 bytes — well under the 65536 byte cap.
      // Under the old char-length check this would have looked oversized when the
      // cap was treated as a byte cap. The new check is byte-correct.
      const secret = '😀'.repeat(10000);
      await expect(handler()({}, { connectionId: 'id', secret })).resolves.toBeUndefined();
      expect(store).toHaveBeenCalledWith('id', secret);
    });

    it('rejects a secret whose byte length exceeds the cap even when char length is under', async () => {
      // 4-byte emoji × 20000 chars = 80000 bytes — over the 65536 byte cap, but
      // only 20000 chars. A char-count check would have let this through.
      const secret = '😀'.repeat(20000);
      await expect(handler()({}, { connectionId: 'id', secret })).rejects.toThrow(/65536-byte/);
      expect(store).not.toHaveBeenCalled();
    });
  });

  describe('retrieve rate limiter', () => {
    it('allows 60 retrievals per 60s window and rejects the 61st', async () => {
      const retr = handlers.get(IPC.CREDENTIAL_RETRIEVE)!;
      // Module-level ring buffer survives across tests; jump real time forward
      // by more than the 60s sliding window so all prior entries are evicted
      // before we measure the cap fresh.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        // Drain the buffer by performing one call, then advancing past the
        // window before the burst — older entries from earlier tests get
        // pruned by checkRetrieveRate's head-advance loop.
        for (let i = 0; i < 60; i++) {
          await expect(retr({}, 'id')).resolves.toBeDefined();
        }
        await expect(retr({}, 'id')).rejects.toThrow(/rate limit/i);
        // After the window slides past, retrieval becomes available again.
        vi.setSystemTime(new Date('2030-01-01T00:02:00Z'));
        await expect(retr({}, 'id')).resolves.toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
