import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const mockMainWindow = {
  id: 1,
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn().mockReturnValue(false),
};

const otherWindow = { id: 2 };

function fromWebContents(sender: { _windowId: number }) {
  return sender._windowId === 1 ? mockMainWindow : otherWindow;
}

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3' },
  BrowserWindow: {
    fromWebContents: (s: { _windowId: number }) => fromWebContents(s),
  },
  shell: { showItemInFolder: vi.fn() },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../services/updater', () => ({
  checkForUpdate: vi.fn().mockResolvedValue({ updateInfo: { version: '1.2.4' } }),
  installUpdate: vi.fn(),
}));

vi.mock('../../services/ssh-manager', () => ({
  sshManager: { listSessions: () => [{ id: 'a', connectionId: 'c1', status: 'connected' }] },
}));

vi.mock('../../services/s3/s3-provider', () => ({
  s3StorageProvider: { listSessions: () => [] },
}));

vi.mock('../../services/credential-store', () => ({
  getCredentialBackendStatus: () => ({ backend: 'safeStorage' }),
}));

vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { getFile: () => ({ path: '/tmp/lunar.log' }) } },
  },
}));

import { registerAppHandlers, setMainWindow } from '../app.ipc';

beforeEach(() => {
  handlers.clear();
  mockMainWindow.minimize.mockClear();
  mockMainWindow.maximize.mockClear();
  mockMainWindow.unmaximize.mockClear();
  mockMainWindow.close.mockClear();
  mockMainWindow.isMaximized.mockReset().mockReturnValue(false);
  setMainWindow(mockMainWindow as unknown as Electron.BrowserWindow);
  registerAppHandlers();
});

describe('app IPC — read-only handlers', () => {
  it('returns the app version', async () => {
    const result = await handlers.get(IPC.APP_GET_VERSION)!({});
    expect(result).toBe('1.2.3');
  });

  it('returns the active sessions snapshot', async () => {
    const result = await handlers.get(IPC.APP_GET_ACTIVE_SESSIONS)!({});
    expect(result).toEqual({
      ssh: [{ id: 'a', connectionId: 'c1', status: 'connected' }],
      s3: [],
    });
  });

  it('returns the credential backend status', async () => {
    const result = await handlers.get(IPC.APP_GET_CREDENTIAL_BACKEND)!({});
    expect(result).toEqual({ backend: 'safeStorage' });
  });

  it('returns the log file path', async () => {
    const result = await handlers.get(IPC.APP_GET_LOG_PATH)!({});
    expect(result).toBe('/tmp/lunar.log');
  });
});

describe('app IPC — window controls', () => {
  it('minimize succeeds when sent from the main window', async () => {
    await handlers.get(IPC.WINDOW_MINIMIZE)!({ sender: { _windowId: 1 } });
    expect(mockMainWindow.minimize).toHaveBeenCalled();
  });

  it('rejects window-control calls from any other window', async () => {
    // The wrapper serialises the LunarError through Error(JSON.stringify(...)).
    // We just need to confirm the handler throws and the action is suppressed.
    await expect(
      handlers.get(IPC.WINDOW_MINIMIZE)!({ sender: { _windowId: 2 } }),
    ).rejects.toThrow();
    expect(mockMainWindow.minimize).not.toHaveBeenCalled();
  });

  it('maximize toggles to maximize when not currently maximized', async () => {
    mockMainWindow.isMaximized.mockReturnValue(false);
    await handlers.get(IPC.WINDOW_MAXIMIZE)!({ sender: { _windowId: 1 } });
    expect(mockMainWindow.maximize).toHaveBeenCalled();
    expect(mockMainWindow.unmaximize).not.toHaveBeenCalled();
  });

  it('maximize toggles to unmaximize when already maximized', async () => {
    mockMainWindow.isMaximized.mockReturnValue(true);
    await handlers.get(IPC.WINDOW_MAXIMIZE)!({ sender: { _windowId: 1 } });
    expect(mockMainWindow.unmaximize).toHaveBeenCalled();
  });

  it('isMaximized reports the underlying window state', async () => {
    mockMainWindow.isMaximized.mockReturnValue(true);
    const result = await handlers.get(IPC.WINDOW_IS_MAXIMIZED)!({ sender: { _windowId: 1 } });
    expect(result).toBe(true);
  });
});
