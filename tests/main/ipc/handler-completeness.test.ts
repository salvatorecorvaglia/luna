import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '@shared/constants';
import { describe, expect, it, vi } from 'vitest';

/**
 * Every channel the preload bridge invokes must have a main-process handler,
 * and every registered handler must be reachable from the bridge.
 *
 * The typed IpcHandlerMap guarantees the *shapes* agree, but nothing checked
 * that `registerAllHandlers()` actually wires each channel: a register call
 * dropped from ipc/index.ts compiled cleanly and failed at runtime with
 * "No handler registered for ...". Conversely a handler with no bridge method
 * is dead attack surface. Both directions are asserted here.
 */

const registered = new Set<string>();

vi.mock('electron', () => {
  const noop = vi.fn();
  return {
    ipcMain: {
      handle: vi.fn((channel: string) => {
        if (registered.has(channel)) throw new Error(`duplicate handler for ${channel}`);
        registered.add(channel);
      }),
      on: noop,
      removeHandler: noop,
    },
    app: {
      getPath: () => '/tmp/luna-test',
      getVersion: () => '0.0.0',
      isPackaged: false,
      on: noop,
    },
    BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
    dialog: { showOpenDialog: noop, showSaveDialog: noop },
    shell: { openExternal: noop, openPath: noop },
    safeStorage: { isEncryptionAvailable: () => false },
  };
});

vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn(), logger: null },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => {
    throw new Error('registering handlers must not open the database');
  },
  getSetting: <T>(_key: string, fallback: T): T => fallback,
  closeDatabase: vi.fn(),
}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Channels the preload passes to `invoke(...)`, read from its source. */
function preloadInvokedChannels(): Set<string> {
  const src = readFileSync(join(__dirname, '../../../src/preload/index.ts'), 'utf-8');
  const names = [...src.matchAll(/invoke\(IPC\.([A-Z0-9_]+)/g)].map((m) => m[1]!);
  const table = IPC as Record<string, string>;
  return new Set(
    names.map((n) => {
      const channel = table[n];
      if (!channel) throw new Error(`preload references unknown IPC.${n}`);
      return channel;
    }),
  );
}

describe('IPC handler completeness', () => {
  it('registers exactly the channels the preload invokes', async () => {
    const { registerAllHandlers } = await import('../../../src/main/ipc');
    registerAllHandlers();

    const invoked = preloadInvokedChannels();
    // Guard against a vacuous pass if the source regex stops matching.
    expect(invoked.size).toBeGreaterThan(30);
    const missingHandlers = [...invoked].filter((c) => !registered.has(c)).sort();
    const unreachableHandlers = [...registered].filter((c) => !invoked.has(c)).sort();

    expect(missingHandlers).toEqual([]);
    expect(unreachableHandlers).toEqual([]);
  });
});
