import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// IPC handlers are registered at import time of `registerSshHandlers`.
// We capture them in a map and exercise the validation paths directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../services/ssh-manager', () => ({
  sshManager: {
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn(),
    sendData: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    resize: vi.fn(),
    trustPendingHostKey: vi.fn().mockReturnValue('SHA256:fp'),
    // sftp-manager is loaded transitively via the storage provider adapter;
    // its constructor wires up a disconnect listener.
    onSessionDisconnect: vi.fn(() => () => {}),
    onSessionConnect: vi.fn(() => () => {}),
    getSession: vi.fn(),
  },
}));

import { sshManager } from '../../services/ssh-manager';
import { registerSshHandlers } from '../ssh.ipc';

const sshManagerMock = sshManager as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  handlers.clear();
  for (const fn of Object.values(sshManagerMock)) {
    if ('mockClear' in fn) {
      fn.mockClear();
    }
  }
  registerSshHandlers();
});

describe('ssh.ipc validation', () => {
  it('SSH_CONNECT rejects empty sessionId / connectionId', async () => {
    const handler = handlers.get(IPC.SSH_CONNECT)!;
    await expect(
      handler({}, { sessionId: '', connectionId: 'c', cols: 80, rows: 24 }),
    ).rejects.toThrow(/sessionId/);
    await expect(
      handler({}, { sessionId: 's', connectionId: '', cols: 80, rows: 24 }),
    ).rejects.toThrow(/connectionId/);
    expect(sshManagerMock.connect).not.toHaveBeenCalled();
  });

  describe('SSH_SEND_DATA size cap', () => {
    it('rejects payloads over 64 KiB', async () => {
      const handler = handlers.get(IPC.SSH_SEND_DATA)!;
      const huge = 'x'.repeat(65537); // 65537 ASCII bytes
      await expect(handler({}, { sessionId: 's', data: huge })).rejects.toThrow(/exceeds/);
      expect(sshManagerMock.sendData).not.toHaveBeenCalled();
    });

    it('accepts payloads at exactly 64 KiB', async () => {
      const handler = handlers.get(IPC.SSH_SEND_DATA)!;
      const ok = 'x'.repeat(65536);
      await expect(handler({}, { sessionId: 's', data: ok })).resolves.not.toThrow();
      expect(sshManagerMock.sendData).toHaveBeenCalledWith('s', ok);
    });

    it('rejects non-string data', async () => {
      const handler = handlers.get(IPC.SSH_SEND_DATA)!;
      await expect(handler({}, { sessionId: 's', data: 123 as unknown as string })).rejects.toThrow(
        /string/,
      );
    });

    it('counts UTF-8 byte length, not character count', async () => {
      const handler = handlers.get(IPC.SSH_SEND_DATA)!;
      // Each '✓' is 3 UTF-8 bytes. 22000 × 3 = 66000 bytes > 65536.
      const tricky = '✓'.repeat(22000);
      await expect(handler({}, { sessionId: 's', data: tricky })).rejects.toThrow(/exceeds/);
    });
  });

  it('SSH_RESIZE rejects out-of-range cols/rows', async () => {
    const handler = handlers.get(IPC.SSH_RESIZE)!;
    await expect(handler({}, { sessionId: 's', cols: 0, rows: 24 })).rejects.toThrow(/cols/);
    await expect(handler({}, { sessionId: 's', cols: 80, rows: 1000 })).rejects.toThrow(/rows/);
    expect(sshManagerMock.resize).not.toHaveBeenCalled();
  });

  it('SSH_TRUST_HOST_KEY validates host and port', async () => {
    const handler = handlers.get(IPC.SSH_TRUST_HOST_KEY)!;
    await expect(handler({}, { host: '', port: 22 })).rejects.toThrow(/host/);
    await expect(handler({}, { host: 'h', port: 0 })).rejects.toThrow(/port/);
    await expect(handler({}, { host: 'h', port: 70000 })).rejects.toThrow(/port/);
  });

  describe('SSH_TEST_CONNECTION', () => {
    it('rejects when both connectionId and config are provided', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      await expect(
        handler(
          {},
          {
            connectionId: 'id',
            config: { host: 'h', port: 22, username: 'u', authType: 'password' },
          },
        ),
      ).rejects.toThrow(/either connectionId or config/);
      expect(sshManagerMock.testConnection).not.toHaveBeenCalled();
    });

    it('rejects when neither is provided', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      await expect(handler({}, {})).rejects.toThrow(/connectionId or config/);
    });

    it('rejects unsupported authType', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      await expect(
        handler({}, { config: { host: 'h', port: 22, username: 'u', authType: 'magic' as never } }),
      ).rejects.toThrow(/authType/);
    });

    it('rejects port outside 1..65535', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      await expect(
        handler({}, { config: { host: 'h', port: 70000, username: 'u', authType: 'password' } }),
      ).rejects.toThrow(/port/);
    });

    it('rejects oversized password (DoS guard)', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      const huge = 'x'.repeat(10_000);
      await expect(
        handler(
          {},
          { config: { host: 'h', port: 22, username: 'u', authType: 'password', password: huge } },
        ),
      ).rejects.toThrow(/password/);
    });

    it('forwards valid config to sshManager.testConnection', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      const params = {
        config: { host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' },
      };
      const result = await handler({}, params);
      expect(sshManagerMock.testConnection).toHaveBeenCalledWith(params);
      expect(result).toEqual({ ok: true });
    });

    it('forwards valid connectionId-only request', async () => {
      const handler = handlers.get(IPC.SSH_TEST_CONNECTION)!;
      const result = await handler({}, { connectionId: 'abc' });
      expect(sshManagerMock.testConnection).toHaveBeenCalledWith({ connectionId: 'abc' });
      expect(result).toEqual({ ok: true });
    });
  });
});
