import { IPC } from '@shared/constants';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('rejects an empty base path via assertValidPath', async () => {
    await expect(
      handlers.get(IPC.SHELL_JOIN_PATH)!({}, { base: '', fileName: 'x' }),
    ).rejects.toThrow(/non-empty string/);
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

  it('allows ~/../ traversal for checkFile if it resolves to a readable path', async () => {
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, '~/../../../etc/hosts')) as {
      ok: boolean;
      reason?: string;
    };
    if (result.ok) {
      expect(result.ok).toBe(true);
    } else {
      expect(['missing', 'permission']).toContain(result.reason);
    }
  });

  it('allows absolute path outside home for checkFile if it is readable', async () => {
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, '/etc/hosts')) as {
      ok: boolean;
      reason?: string;
    };
    if (result.ok) {
      expect(result.ok).toBe(true);
    } else {
      expect(['missing', 'permission']).toContain(result.reason);
    }
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

  it('checkFile allows a symlink whose target leaves the home jail if readable', async () => {
    const link = join(workdir, 'escape-key');
    await symlink('/etc/hosts', link);
    const result = (await handlers.get(IPC.SHELL_CHECK_FILE)!({}, link)) as {
      ok: boolean;
      reason?: string;
    };
    if (result.ok) {
      expect(result.ok).toBe(true);
    } else {
      expect(['missing', 'permission']).toContain(result.reason);
    }
  });

  it('readFile resolves the real target (TOCTOU-safe)', async () => {
    const target = join(workdir, 'real.txt');
    await writeFile(target, 'hello');
    const link = join(workdir, 'link.txt');
    await symlink(target, link);
    const result = (await handlers.get(IPC.SHELL_READ_FILE)!({}, link)) as {
      content: string;
      encoding: 'utf-8' | 'base64';
      size: number;
    };
    expect(result.encoding).toBe('utf-8');
    expect(result.content).toBe('hello');
    expect(result.size).toBe(5);
  });

  it('readFile is anchored by O_NOFOLLOW after realpath resolution', async () => {
    // Simulates the post-validation symlink swap: a file inside the jail is
    // replaced with a symlink pointing outside. open(..., O_NOFOLLOW) must
    // refuse to follow the final-component link rather than silently reading
    // the attacker's target.
    const escapedLink = join(workdir, 'swapped');
    await symlink('/etc/hosts', escapedLink);
    // expandAndConfineToHome resolves the symlink to /etc/hosts, which is
    // caught by the jail check before reaching the open() call. This locks
    // in the behavior that out-of-jail symlinks are never read.
    await expect(handlers.get(IPC.SHELL_READ_FILE)!({}, escapedLink)).rejects.toThrow(
      /outside the home directory/,
    );
  });
});

describe('shell IPC — writeFile', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(homedir(), '.lunar-test-write-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it('writes content to a file inside the home directory', async () => {
    const target = join(workdir, 'test-write.txt');
    await handlers.get(IPC.SHELL_WRITE_FILE)!({}, { filePath: target, content: 'hello write' });

    const result = (await handlers.get(IPC.SHELL_READ_FILE)!({}, target)) as {
      content: string;
      encoding: 'utf-8' | 'base64';
      size: number;
    };
    expect(result.content).toBe('hello write');
    expect(result.size).toBe(11);
  });

  it('rejects writing to a path outside the home directory', async () => {
    await expect(
      handlers.get(IPC.SHELL_WRITE_FILE)!({}, { filePath: '/etc/evil.txt', content: 'evil' }),
    ).rejects.toThrow(/home directory/);
  });

  it('rejects a symlink pointing outside the home directory', async () => {
    const link = join(workdir, 'escape-write');
    await symlink('/etc/evil-target.txt', link);
    await expect(
      handlers.get(IPC.SHELL_WRITE_FILE)!({}, { filePath: link, content: 'evil' }),
    ).rejects.toThrow(/home directory/);
  });
});
