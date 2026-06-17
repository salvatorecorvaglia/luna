import { IPC } from '@shared/constants';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the handlers as they're registered so we can drive them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

const listMock = vi.fn().mockResolvedValue([]);
vi.mock('../../services/storage/registry', () => ({
  storageRegistry: {
    require: vi.fn(() => ({
      list: listMock,
      stat: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      readFile: vi.fn(),
    })),
  },
}));
vi.mock('../../services/transfer-queue', () => ({
  transferQueue: { enqueue: vi.fn() },
}));

const home = homedir();
const sandboxRoot = mkdtempSync(join(home, '.lunar-test-storageipc-'));
const sandboxFile = join(sandboxRoot, 'file.bin');
writeFileSync(sandboxFile, 'data');

afterAll(() => {
  try {
    rmSync(sandboxRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

import { __resetStorageRateLimiter, registerStorageHandlers } from '../storage.ipc';

beforeEach(() => {
  handlers.clear();
  listMock.mockClear();
  __resetStorageRateLimiter();
  registerStorageHandlers();
});

describe('storage.ipc rate limiter', () => {
  it('allows bursts up to the bucket cap', async () => {
    const list = handlers.get(IPC.STORAGE_LIST)!;
    // 30-token bucket: 30 calls in a row should all succeed.
    for (let i = 0; i < 30; i++) {
      await list({}, { sessionId: 's1', path: '/' });
    }
    expect(listMock).toHaveBeenCalledTimes(30);
  });

  it('throws when the bucket is exhausted', async () => {
    const list = handlers.get(IPC.STORAGE_LIST)!;
    for (let i = 0; i < 30; i++) {
      await list({}, { sessionId: 's1', path: '/' });
    }
    // 31st call within the same instant overflows.
    await expect(list({}, { sessionId: 's1', path: '/' })).rejects.toThrow(/rate limit/);
  });

  it('isolates buckets per session', async () => {
    const list = handlers.get(IPC.STORAGE_LIST)!;
    for (let i = 0; i < 30; i++) {
      await list({}, { sessionId: 's1', path: '/' });
    }
    // Different session keeps its own full bucket.
    await expect(list({}, { sessionId: 's2', path: '/' })).resolves.not.toThrow();
  });
});

describe('storage IPC — validation', () => {
  it('list rejects empty sessionId', async () => {
    await expect(handlers.get(IPC.STORAGE_LIST)!({}, { sessionId: '', path: '/' })).rejects.toThrow(
      /sessionId/,
    );
  });

  it('stat rejects empty path', async () => {
    await expect(
      handlers.get(IPC.STORAGE_STAT)!({}, { sessionId: 's1', path: '' }),
    ).rejects.toThrow(/path/);
  });

  it('readFile rejects out-of-range maxSize', async () => {
    await expect(
      handlers.get(IPC.STORAGE_READ_FILE)!({}, { sessionId: 's1', path: '/x', maxSize: 0 }),
    ).rejects.toThrow();
  });
});

describe('storage IPC — transfers', () => {
  it('download enqueues with resolved local path', async () => {
    const { transferQueue } = await import('../../services/transfer-queue');
    const enqueue = transferQueue.enqueue as ReturnType<typeof vi.fn>;
    enqueue.mockResolvedValue('t1');

    const out = await handlers.get(IPC.STORAGE_DOWNLOAD)!(
      {},
      { sessionId: 's1', remotePath: '/srv/a.txt', localPath: sandboxFile },
    );
    expect(enqueue).toHaveBeenCalledWith('download', 's1', sandboxFile, '/srv/a.txt');
    expect(out).toBe('t1');
  });

  it('download refuses path outside home', async () => {
    await expect(
      handlers.get(IPC.STORAGE_DOWNLOAD)!(
        {},
        { sessionId: 's1', remotePath: '/srv/x', localPath: '/etc/passwd' },
      ),
    ).rejects.toThrow();
  });
});
