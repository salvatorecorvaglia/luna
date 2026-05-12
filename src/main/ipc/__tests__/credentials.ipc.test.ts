import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCredentialHandlers } from '../credentials.ipc';
import { IPC } from '@shared/constants';

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
vi.mock('../../services/credential-store', () => ({
  storeCredential: (...a: unknown[]) => store(...a),
  retrieveCredential: (...a: unknown[]) => retrieve(...a),
  deleteCredential: (...a: unknown[]) => del(...a),
  onCredentialTamper: () => () => {},
}));

vi.mock('../app.ipc', () => ({
  getMainWindow: () => null,
}));

vi.mock('../../lib/logger', () => ({
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
});
