import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
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

  it('returns {ok:false, reason:"forbidden"} for ~/../ traversal', async () => {
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, '~/../../../etc/passwd')) as {
      ok: boolean;
      reason?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden');
  });

  it('returns {ok:false, reason:"forbidden"} for absolute path outside home', async () => {
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, '/etc/passwd')) as {
      ok: boolean;
      reason?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden');
  });
});

describe('shell IPC — symlink jail (TOCTOU & bypass)', () => {
  let workdir: string;

  beforeEach(async () => {
    // Create a working directory inside HOME so jail checks pass for the link,
    // but with a target outside HOME so we can verify the dereferenced target is rejected.
    workdir = await mkdtemp(join(homedir(), '.lunar-test-symlink-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it('readFile rejects a symlink inside home pointing outside', async () => {
    const link = join(workdir, 'escape');
    // /etc exists on darwin/linux; use a system path outside the home jail.
    await symlink('/etc/hosts', link);
    await expect(handlers.get(IPC.SHELL_READ_FILE)!({}, link)).rejects.toThrow(
      /outside the home directory/,
    );
  });

  it('readdir does not classify an out-of-home symlink target as a directory', async () => {
    const subdir = join(workdir, 'sub');
    await mkdir(subdir);
    const link = join(subdir, 'etc-link');
    await symlink('/etc', link);
    const entries = (await handlers.get(IPC.SHELL_READDIR)!({}, subdir)) as {
      name: string;
      isDirectory: boolean;
      isSymlink: boolean;
    }[];
    const entry = entries.find((e) => e.name === 'etc-link');
    expect(entry).toBeDefined();
    expect(entry!.isSymlink).toBe(true);
    // /etc *is* a directory but it's outside the jail — must not be marked navigable.
    expect(entry!.isDirectory).toBe(false);
  });

  it('checkFile rejects a symlink whose target leaves the home jail', async () => {
    const link = join(workdir, 'escape-key');
    await symlink('/etc/hosts', link);
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, link)) as {
      ok: boolean;
      reason?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden');
  });

  it('readFile resolves the real target (TOCTOU-safe)', async () => {
    const target = join(workdir, 'real.txt');
    await writeFile(target, 'hello');
    const link = join(workdir, 'link.txt');
    await symlink(target, link);
    const result = (await handlers.get(IPC.SHELL_READ_FILE)!({}, link)) as {
      content: string;
      size: number;
    };
    expect(Buffer.from(result.content, 'base64').toString()).toBe('hello');
    expect(result.size).toBe(5);
  });
});
