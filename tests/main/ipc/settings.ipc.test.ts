import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

// Allocated inside the factory so vi.mock's hoist doesn't capture an
// uninitialised reference; read back through the intercepted import below.
vi.mock('../../../src/main/services/database', () => {
  const rows = new Map<string, string>();
  return {
    __rows: rows,
    getDatabase: () => ({
      prepare: (sql: string) => {
        if (sql.includes('SELECT value FROM settings WHERE key')) {
          return {
            get: (key: string) => (rows.has(key) ? { value: rows.get(key) } : undefined),
          };
        }
        if (sql.includes('SELECT key, value FROM settings')) {
          return {
            all: () => Array.from(rows.entries()).map(([key, value]) => ({ key, value })),
          };
        }
        if (sql.includes('INSERT OR REPLACE INTO settings')) {
          return {
            run: (key: string, value: string) => {
              rows.set(key, value);
            },
          };
        }
        throw new Error(`Unexpected SQL in test mock: ${sql}`);
      },
    }),
  };
});

const setMaxConcurrent = vi.fn();
vi.mock('../../../src/main/services/transfer-queue', () => ({
  transferQueue: { setMaxConcurrent: (...a: unknown[]) => setMaxConcurrent(...a) },
}));

const invalidateRuntimeCache = vi.fn();
vi.mock('../../../src/main/config/runtime', () => ({
  invalidateRuntimeCache: (...a: unknown[]) => invalidateRuntimeCache(...a),
  RUNTIME_BOUNDS: {},
}));

import { registerSettingsHandlers } from '../../../src/main/ipc/settings.ipc';
import * as databaseMock from '../../../src/main/services/database';

const rows = (databaseMock as unknown as { __rows: Map<string, string> }).__rows;

beforeEach(() => {
  handlers.clear();
  rows.clear();
  setMaxConcurrent.mockClear();
  invalidateRuntimeCache.mockClear();
  registerSettingsHandlers();
});

describe('settings IPC — SETTINGS_GET', () => {
  it('rejects an unknown key', async () => {
    await expect(handlers.get(IPC.SETTINGS_GET)!({}, 'not.a.real.key')).rejects.toThrow(
      /Unknown setting key/,
    );
  });

  it('returns null when no row is stored for a known key', async () => {
    await expect(handlers.get(IPC.SETTINGS_GET)!({}, 'terminal.fontSize')).resolves.toBeNull();
  });

  it('returns the parsed value for a known key with a valid stored row', async () => {
    rows.set('terminal.theme', JSON.stringify('nord'));
    await expect(handlers.get(IPC.SETTINGS_GET)!({}, 'terminal.theme')).resolves.toBe('nord');
  });

  it('returns null for a stored row whose type no longer matches (defensive against stale rows)', async () => {
    rows.set('terminal.fontSize', JSON.stringify('not-a-number'));
    await expect(handlers.get(IPC.SETTINGS_GET)!({}, 'terminal.fontSize')).resolves.toBeNull();
  });
});

describe('settings IPC — SETTINGS_SET', () => {
  it('rejects an unknown key', async () => {
    await expect(handlers.get(IPC.SETTINGS_SET)!({}, { key: 'nope', value: '1' })).rejects.toThrow(
      /Unknown setting key/,
    );
  });

  it('rejects a non-string value', async () => {
    await expect(
      handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.fontSize', value: 14 }),
    ).rejects.toThrow(/JSON-encoded string/);
  });

  it('rejects a value that is not valid JSON', async () => {
    await expect(
      handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.fontSize', value: 'not-json{' }),
    ).rejects.toThrow(/must be JSON-encoded/);
  });

  it('rejects a value of the wrong type', async () => {
    await expect(
      handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.theme', value: JSON.stringify(123) }),
    ).rejects.toThrow(/wrong type/);
  });

  it('rejects a numeric value outside its bounds', async () => {
    await expect(
      handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.fontSize', value: JSON.stringify(999) }),
    ).rejects.toThrow(/must be a number between/);
  });

  it('accepts a valid value, stores canonical JSON, and invalidates the runtime cache', async () => {
    await handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.theme', value: '  "nord"  ' });
    expect(rows.get('terminal.theme')).toBe(JSON.stringify('nord'));
    expect(invalidateRuntimeCache).toHaveBeenCalledTimes(1);
  });

  it('re-applies transfer.concurrency to the live transfer queue', async () => {
    await handlers.get(IPC.SETTINGS_SET)!({}, { key: 'transfer.concurrency', value: '5' });
    expect(setMaxConcurrent).toHaveBeenCalledWith(5);
  });

  it('does not touch the transfer queue for unrelated keys', async () => {
    await handlers.get(IPC.SETTINGS_SET)!({}, { key: 'terminal.theme', value: '"nord"' });
    expect(setMaxConcurrent).not.toHaveBeenCalled();
  });
});

describe('settings IPC — SETTINGS_GET_ALL', () => {
  it('returns an empty object when nothing is stored', async () => {
    await expect(handlers.get(IPC.SETTINGS_GET_ALL)!({})).resolves.toEqual({});
  });

  it('returns parsed values for all stored keys', async () => {
    rows.set('terminal.theme', JSON.stringify('gruvbox'));
    rows.set('terminal.fontSize', JSON.stringify(16));
    await expect(handlers.get(IPC.SETTINGS_GET_ALL)!({})).resolves.toEqual({
      'terminal.theme': 'gruvbox',
      'terminal.fontSize': 16,
    });
  });

  it('silently drops a row with unparseable JSON', async () => {
    rows.set('terminal.theme', 'not-json{');
    rows.set('terminal.fontSize', JSON.stringify(16));
    await expect(handlers.get(IPC.SETTINGS_GET_ALL)!({})).resolves.toEqual({
      'terminal.fontSize': 16,
    });
  });

  it('silently drops a row whose stored type no longer matches the setting', async () => {
    rows.set('terminal.fontSize', JSON.stringify('not-a-number'));
    await expect(handlers.get(IPC.SETTINGS_GET_ALL)!({})).resolves.toEqual({});
  });
});
