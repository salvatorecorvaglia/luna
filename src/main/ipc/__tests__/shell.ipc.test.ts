import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';
import { homedir } from 'os';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

import { registerShellHandlers } from '../shell.ipc';

beforeEach(() => {
  handlers.clear();
  registerShellHandlers();
});

describe('shell IPC — homeDir', () => {
  it('returns os.homedir()', async () => {
    const result = await handlers.get(IPC.SHELL_HOME_DIR)!({});
    expect(result).toBe(homedir());
  });
});

describe('shell IPC — joinPath', () => {
  it('strips path separators from fileName before joining', async () => {
    const home = homedir();
    const result = await handlers.get(IPC.SHELL_JOIN_PATH)!(
      {},
      { base: home, fileName: 'sub/evil.txt' },
    );
    // basename() should reduce 'sub/evil.txt' → 'evil.txt'
    expect(result).toBe(`${home}/evil.txt`);
  });

  it('refuses traversal segments embedded in fileName', async () => {
    const home = homedir();
    // basename('../../etc/passwd') is 'passwd' — the resolved path is base/passwd,
    // never escapes. This documents the contract.
    const result = await handlers.get(IPC.SHELL_JOIN_PATH)!(
      {},
      { base: home, fileName: '../../etc/passwd' },
    );
    expect(result).toBe(`${home}/passwd`);
  });

  it('rejects an empty base path via assertValidPath', () => {
    // SHELL_JOIN_PATH is registered as a sync handler; the throw propagates synchronously.
    expect(() => handlers.get(IPC.SHELL_JOIN_PATH)!({}, { base: '', fileName: 'x' })).toThrow(
      /non-empty string/,
    );
  });
});

describe('shell IPC — readFile jail', () => {
  it('refuses paths outside the home directory', async () => {
    await expect(handlers.get(IPC.SHELL_READ_FILE)!({}, '/etc/passwd')).rejects.toThrow(
      /home directory/,
    );
  });
});

describe('shell IPC — checkFile', () => {
  it('returns {ok:false, reason:"empty"} for empty input', async () => {
    const result = await handlers.get(IPC.SHELL_CHECK_FILE)!({}, '');
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns {ok:false, reason:"missing"} for a path that does not exist', async () => {
    const result = await handlers.get(IPC.SHELL_CHECK_FILE)!(
      {},
      `${homedir()}/.lunar-test-nonexistent-${Date.now()}`,
    );
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });
});
