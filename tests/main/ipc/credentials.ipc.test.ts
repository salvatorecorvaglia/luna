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

type TamperListener = (event: unknown) => void;
let tamperListener: TamperListener | null = null;
vi.mock('../../../src/main/services/credential-store', () => ({
  onCredentialTamper: (cb: TamperListener) => {
    tamperListener = cb;
    return () => {};
  },
}));

const send = vi.fn();
let window: { isDestroyed: () => boolean; webContents: { send: typeof send } } | null = null;
vi.mock('../../../src/main/ipc/app.ipc', () => ({
  getMainWindow: () => window,
}));

beforeEach(() => {
  handlers.clear();
  send.mockClear();
  tamperListener = null;
  window = { isDestroyed: () => false, webContents: { send } };
  registerCredentialHandlers();
});

describe('credentials IPC', () => {
  it('exposes no invoke channel — secrets never cross to the renderer', () => {
    // credential:retrieve returned any saved password in plaintext to a caller
    // nothing in the UI ever was. The store/delete/resolve-external channels
    // were equally unused. Main reads and writes secrets itself.
    expect(handlers.size).toBe(0);
    for (const channel of Object.values(IPC)) {
      expect(channel).not.toMatch(/^credential:(store|retrieve|delete|resolve-external)$/);
    }
  });

  it('forwards tamper events to the main window', () => {
    const event = { connectionId: 'c1', reason: 'auth-tag' };
    tamperListener?.(event);
    expect(send).toHaveBeenCalledWith(IPC.CREDENTIAL_ON_TAMPER, event);
  });

  it('drops tamper events when the window is gone', () => {
    window = null;
    tamperListener?.({ connectionId: 'c1' });
    window = { isDestroyed: () => true, webContents: { send } };
    tamperListener?.({ connectionId: 'c1' });
    expect(send).not.toHaveBeenCalled();
  });
});
