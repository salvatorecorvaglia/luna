import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';

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
