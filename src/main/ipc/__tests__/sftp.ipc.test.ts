import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';
import { homedir } from 'os';
import { tmpdir } from 'os';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../services/sftp-manager', () => ({
  sftpManager: {
    list: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock('../../services/transfer-queue', () => ({
  transferQueue: {
    enqueue: vi.fn(),
    cancel: vi.fn(),
    cancelBySession: vi.fn(),
  },
}));

import { registerSftpHandlers } from '../sftp.ipc';
import { sftpManager } from '../../services/sftp-manager';
import { transferQueue } from '../../services/transfer-queue';

const list = sftpManager.list as ReturnType<typeof vi.fn>;
const stat = sftpManager.stat as ReturnType<typeof vi.fn>;
const mkdir = sftpManager.mkdir as ReturnType<typeof vi.fn>;
const rename = sftpManager.rename as ReturnType<typeof vi.fn>;
const remove = sftpManager.remove as ReturnType<typeof vi.fn>;
const readFile = sftpManager.readFile as ReturnType<typeof vi.fn>;
const enqueue = transferQueue.enqueue as ReturnType<typeof vi.fn>;
const cancel = transferQueue.cancel as ReturnType<typeof vi.fn>;
const cancelBySession = transferQueue.cancelBySession as ReturnType<typeof vi.fn>;

// Build a real path under $HOME so assertSafeRealAbsolutePath (which
// realpath()s the parent) finds the directory it expects.
const home = homedir();
const sandboxRoot = mkdtempSync(join(home, '.lunar-test-sftpipc-'));
const sandboxFile = join(sandboxRoot, 'file.bin');
writeFileSync(sandboxFile, 'data');
const sandboxSubdir = join(sandboxRoot, 'sub');
mkdirSync(sandboxSubdir, { recursive: true });

beforeEach(() => {
  handlers.clear();
  list.mockReset();
  stat.mockReset();
  mkdir.mockReset();
  rename.mockReset();
  remove.mockReset();
  readFile.mockReset();
  enqueue.mockReset();
  cancel.mockReset();
  cancelBySession.mockReset();
  registerSftpHandlers();
});

describe('sftp IPC — input validation', () => {
  it('list rejects empty sessionId', async () => {
    await expect(handlers.get(IPC.SFTP_LIST)!({}, { sessionId: '', path: '/' })).rejects.toThrow(
      /sessionId/,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('stat rejects an empty path', async () => {
    await expect(
      handlers.get(IPC.SFTP_STAT)!({}, { sessionId: 's1', path: '' }),
    ).rejects.toThrow();
    expect(stat).not.toHaveBeenCalled();
  });

  it('readFile rejects out-of-range maxSize', async () => {
    await expect(
      handlers.get(IPC.SFTP_READ_FILE)!({}, { sessionId: 's1', path: '/x', maxSize: 0 }),
    ).rejects.toThrow();
  });

  it('readFile rejects non-numeric maxSize', async () => {
    await expect(
      handlers.get(IPC.SFTP_READ_FILE)!(
        {},
        { sessionId: 's1', path: '/x', maxSize: 'huge' as unknown as number },
      ),
    ).rejects.toThrow();
  });

  it('transfer:cancel rejects empty transferId (sync handler)', () => {
    expect(() => handlers.get(IPC.TRANSFER_CANCEL)!({}, '')).toThrow();
  });

  it('transfer:cancel-by-session rejects empty sessionId (sync handler)', () => {
    expect(() => handlers.get(IPC.TRANSFER_CANCEL_BY_SESSION)!({}, '')).toThrow();
  });
});

describe('sftp IPC — happy paths delegate to manager', () => {
  it('list passes sessionId+path through to sftpManager.list', async () => {
    list.mockResolvedValue([{ name: 'a' }]);
    const out = await handlers.get(IPC.SFTP_LIST)!({}, { sessionId: 's1', path: '/srv' });
    expect(list).toHaveBeenCalledWith('s1', '/srv');
    expect(out).toEqual([{ name: 'a' }]);
  });

  it('mkdir passes through', async () => {
    mkdir.mockResolvedValue(undefined);
    await handlers.get(IPC.SFTP_MKDIR)!({}, { sessionId: 's1', path: '/srv/new' });
    expect(mkdir).toHaveBeenCalledWith('s1', '/srv/new');
  });

  it('rename forwards both paths', async () => {
    rename.mockResolvedValue(undefined);
    await handlers.get(IPC.SFTP_RENAME)!(
      {},
      { sessionId: 's1', oldPath: '/a', newPath: '/b' },
    );
    expect(rename).toHaveBeenCalledWith('s1', '/a', '/b');
  });

  it('delete forwards isDirectory', async () => {
    remove.mockResolvedValue(undefined);
    await handlers.get(IPC.SFTP_DELETE)!(
      {},
      { sessionId: 's1', path: '/srv/dir', isDirectory: true },
    );
    expect(remove).toHaveBeenCalledWith('s1', '/srv/dir', true);
  });

  it('readFile forwards maxSize when provided', async () => {
    readFile.mockResolvedValue({ content: 'aGk=', size: 2 });
    await handlers.get(IPC.SFTP_READ_FILE)!(
      {},
      { sessionId: 's1', path: '/x', maxSize: 1024 },
    );
    expect(readFile).toHaveBeenCalledWith('s1', '/x', 1024);
  });
});

describe('sftp IPC — transfer enqueues', () => {
  it('download enqueues with the realpath-resolved local path', async () => {
    enqueue.mockResolvedValue('t1');
    const out = await handlers.get(IPC.SFTP_DOWNLOAD)!(
      {},
      { sessionId: 's1', remotePath: '/srv/log.txt', localPath: sandboxFile },
    );
    expect(enqueue).toHaveBeenCalledWith('download', 's1', sandboxFile, '/srv/log.txt');
    expect(out).toBe('t1');
  });

  it('upload enqueues with the realpath-resolved source', async () => {
    enqueue.mockResolvedValue('t2');
    const out = await handlers.get(IPC.SFTP_UPLOAD)!(
      {},
      { sessionId: 's1', localPath: sandboxFile, remotePath: '/srv/log.txt' },
    );
    expect(enqueue).toHaveBeenCalledWith('upload', 's1', sandboxFile, '/srv/log.txt');
    expect(out).toBe('t2');
  });

  it('download refuses a localPath outside the home jail', async () => {
    await expect(
      handlers.get(IPC.SFTP_DOWNLOAD)!(
        {},
        { sessionId: 's1', remotePath: '/srv/x', localPath: '/etc/passwd' },
      ),
    ).rejects.toThrow();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('cancel forwards transferId to the queue', async () => {
    await handlers.get(IPC.TRANSFER_CANCEL)!({}, 't9');
    expect(cancel).toHaveBeenCalledWith('t9');
  });

  it('cancel-by-session forwards sessionId', async () => {
    await handlers.get(IPC.TRANSFER_CANCEL_BY_SESSION)!({}, 's5');
    expect(cancelBySession).toHaveBeenCalledWith('s5');
  });
});

// Use the temp-dir cleanup hook so we don't pollute $HOME on rerun.
import { afterAll } from 'vitest';
import { rmSync } from 'fs';
afterAll(() => {
  try {
    rmSync(sandboxRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// Suppress unused-import lint
void tmpdir;
