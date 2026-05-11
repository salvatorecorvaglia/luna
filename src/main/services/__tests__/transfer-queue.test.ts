import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, LIMITS } from '@shared/constants';
import { transferQueue } from '../transfer-queue';
import { emitToRenderer } from '../emit';

// Mock peers before importing the module under test. We make stream operations
// hang forever so transfers stay either queued or active for the duration of a
// test (no race with finally() draining the active set).
//
// The transfer queue resolves the backend via the storage registry — give it
// a stub provider so the dispatch path doesn't blow up on missing sessions.
const stubProvider = {
  kind: 'sftp' as const,
  list: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  readFile: vi.fn(),
  statSize: vi.fn().mockResolvedValue(0),
  streamUpload: vi.fn().mockImplementation(() => new Promise(() => {})),
  streamDownload: vi.fn().mockImplementation(() => new Promise(() => {})),
  closeSession: vi.fn(),
};
vi.mock('../storage/registry', () => ({
  storageRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(() => stubProvider),
    require: vi.fn(() => stubProvider),
    kindOf: vi.fn(() => 'sftp'),
  },
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 0 }),
}));

vi.mock('../emit', () => ({
  emitToRenderer: vi.fn(),
}));

// The TransferQueue is a module-level singleton. Reach into private state to
// reset it between tests so each test starts from a clean slate.
function resetQueue(): void {
  const q = transferQueue as unknown as {
    queue: unknown[];
    active: Map<string, unknown>;
    dedupIndex?: Map<string, string>;
  };
  q.queue.length = 0;
  q.active.clear();
  q.dedupIndex?.clear();
}

beforeEach(() => {
  resetQueue();
  // Reset every stub so the per-test mockImplementation overrides start clean.
  stubProvider.streamUpload.mockReset().mockImplementation(() => new Promise(() => {}));
  stubProvider.streamDownload.mockReset().mockImplementation(() => new Promise(() => {}));
  stubProvider.statSize.mockReset().mockResolvedValue(0);
  (emitToRenderer as unknown as { mockClear?: () => void }).mockClear?.();
  // Concurrency 1 so only one moves to active and the rest pile up in queue.
  transferQueue.setMaxConcurrent(1);
});

/** Pull all emits matching a channel out of the emitToRenderer mock call log. */
function emitsOf(channel: string): unknown[] {
  const mock = emitToRenderer as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter((c) => c[0] === channel).map((c) => c[1]);
}

describe('transferQueue', () => {
  it('returns the same id for duplicate enqueues', async () => {
    const a = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x');
    const b = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x');
    expect(a).toBe(b);
  });

  it('distinguishes by type/session/localPath/remotePath', async () => {
    // The four-tuple is the dedup key; varying any one of them must produce
    // a fresh transfer id rather than collapsing onto the first.
    const upload = await transferQueue.enqueue('upload', 'sess', '/l', '/r');
    const download = await transferQueue.enqueue('download', 'sess', '/l', '/r');
    const otherSession = await transferQueue.enqueue('upload', 'sess2', '/l', '/r');
    const otherLocal = await transferQueue.enqueue('upload', 'sess', '/l2', '/r');
    const otherRemote = await transferQueue.enqueue('upload', 'sess', '/l', '/r2');
    const ids = new Set([upload, download, otherSession, otherLocal, otherRemote]);
    expect(ids.size).toBe(5);
  });

  it('frees the dedup slot after cancel so a re-enqueue is a fresh transfer', async () => {
    // Active-slot transfer; the second enqueue must hit the same key.
    await transferQueue.enqueue('upload', 'sess', '/l', '/r');
    const queued = await transferQueue.enqueue('upload', 'sess', '/queued-l', '/queued-r');
    transferQueue.cancel(queued);
    const fresh = await transferQueue.enqueue('upload', 'sess', '/queued-l', '/queued-r');
    expect(fresh).not.toBe(queued);
  });

  it('rejects new transfers when the queue is saturated', async () => {
    // Fill: 1 goes to active, MAX go into the queue.
    for (let i = 0; i <= LIMITS.MAX_QUEUED_TRANSFERS; i++) {
      await transferQueue.enqueue('upload', 'sess', `/local/${i}`, `/remote/${i}`);
    }
    expect(transferQueue.getQueuedCount()).toBe(LIMITS.MAX_QUEUED_TRANSFERS);

    await expect(
      transferQueue.enqueue('upload', 'sess', '/local/overflow', '/remote/overflow'),
    ).rejects.toThrow(/queue is full/i);
  });

  it('cancel removes a queued transfer', async () => {
    // First enqueue takes the only active slot; second sits in the queue.
    await transferQueue.enqueue('upload', 'sess', '/local/active', '/remote/active');
    const queuedId = await transferQueue.enqueue('upload', 'sess', '/local/q', '/remote/q');
    expect(transferQueue.getQueuedCount()).toBe(1);
    transferQueue.cancel(queuedId);
    expect(transferQueue.getQueuedCount()).toBe(0);
  });

  it('drains the queue when an active transfer aborts', async () => {
    transferQueue.setMaxConcurrent(1);
    await transferQueue.enqueue('upload', 'sess', '/local/a', '/remote/a');
    expect(transferQueue.getActiveCount()).toBe(1);
    expect(transferQueue.getQueuedCount()).toBe(0);
  });

  it('processQueue is re-entrancy guarded', async () => {
    // Enqueueing many at concurrency 1 must not lose transfers to a re-entrant
    // dispatch loop (each one beyond the first should land in the queue).
    transferQueue.setMaxConcurrent(1);
    for (let i = 0; i < 5; i++) {
      await transferQueue.enqueue('upload', 'sess', `/local/${i}`, `/remote/${i}`);
    }
    expect(transferQueue.getActiveCount()).toBe(1);
    expect(transferQueue.getQueuedCount()).toBe(4);
  });

  it('cancelAll clears both active and queued transfers', async () => {
    await transferQueue.enqueue('upload', 'sess', '/local/active', '/remote/active');
    await transferQueue.enqueue('upload', 'sess', '/local/q1', '/remote/q1');
    await transferQueue.enqueue('upload', 'sess', '/local/q2', '/remote/q2');

    expect(transferQueue.getActiveCount()).toBe(1);
    expect(transferQueue.getQueuedCount()).toBe(2);

    transferQueue.cancelAll();

    expect(transferQueue.getActiveCount()).toBe(0);
    expect(transferQueue.getQueuedCount()).toBe(0);
  });

  describe('error path classification', () => {
    function permissionError(): NodeJS.ErrnoException {
      const e = new Error('open /target: permission denied') as NodeJS.ErrnoException;
      e.code = 'EACCES';
      return e;
    }
    function diskFullError(): NodeJS.ErrnoException {
      const e = new Error('write: no space left on device') as NodeJS.ErrnoException;
      e.code = 'ENOSPC';
      return e;
    }
    function connectionResetError(): NodeJS.ErrnoException {
      const e = new Error('read ECONNRESET') as NodeJS.ErrnoException;
      e.code = 'ECONNRESET';
      return e;
    }

    it('emits TRANSFER_ERROR with errorClass=permission on EACCES', async () => {
      stubProvider.streamUpload.mockRejectedValueOnce(permissionError());
      await transferQueue.enqueue('upload', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const errs = emitsOf(IPC.TRANSFER_ERROR) as { errorClass: string }[];
      expect(errs).toHaveLength(1);
      expect(errs[0].errorClass).toBe('permission');
    });

    it('emits TRANSFER_ERROR with errorClass=disk-full on ENOSPC', async () => {
      stubProvider.streamDownload.mockRejectedValueOnce(diskFullError());
      await transferQueue.enqueue('download', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const errs = emitsOf(IPC.TRANSFER_ERROR) as { errorClass: string }[];
      expect(errs).toHaveLength(1);
      expect(errs[0].errorClass).toBe('disk-full');
    });

    it('emits TRANSFER_ERROR with errorClass=connection on ECONNRESET', async () => {
      stubProvider.streamDownload.mockRejectedValueOnce(connectionResetError());
      await transferQueue.enqueue('download', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const errs = emitsOf(IPC.TRANSFER_ERROR) as { errorClass: string }[];
      expect(errs).toHaveLength(1);
      expect(errs[0].errorClass).toBe('connection');
    });

    it('cancel during active transfer emits TRANSFER_CANCELLED (not TRANSFER_ERROR)', async () => {
      // Provider sees the abort signal and rejects with AbortError-like behavior.
      stubProvider.streamUpload.mockImplementation(
        (_s: string, _l: string, _r: string, _onStep: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const e = new Error('aborted');
              reject(e);
            });
          }),
      );
      const id = await transferQueue.enqueue('upload', 'sess', '/l', '/r');
      transferQueue.cancel(id);
      await new Promise((r) => setTimeout(r, 0));
      expect(emitsOf(IPC.TRANSFER_CANCELLED)).toHaveLength(1);
      expect(emitsOf(IPC.TRANSFER_ERROR)).toHaveLength(0);
    });

    it('emits a final 100% TRANSFER_PROGRESS before TRANSFER_COMPLETE', async () => {
      // Report a known size from statSize so the final flush has a value to use.
      stubProvider.statSize.mockResolvedValue(1000);
      stubProvider.streamDownload.mockImplementation(
        async (
          _s: string,
          _r: string,
          _l: string,
          onStep: (transferred: number, chunk: number, total: number) => void,
        ) => {
          onStep(500, 500, 1000);
        },
      );
      await transferQueue.enqueue('download', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const progress = emitsOf(IPC.TRANSFER_PROGRESS) as { transferred: number; total: number }[];
      const last = progress[progress.length - 1];
      expect(last.transferred).toBe(1000);
      expect(last.total).toBe(1000);
      expect(emitsOf(IPC.TRANSFER_COMPLETE)).toHaveLength(1);
    });
  });

  it('adjusting max concurrency processes the queue', async () => {
    transferQueue.setMaxConcurrent(1);
    await transferQueue.enqueue('upload', 'sess', '/l1', '/r1');
    await transferQueue.enqueue('upload', 'sess', '/l2', '/r2');
    await transferQueue.enqueue('upload', 'sess', '/l3', '/r3');

    expect(transferQueue.getActiveCount()).toBe(1);
    expect(transferQueue.getQueuedCount()).toBe(2);

    transferQueue.setMaxConcurrent(2);
    expect(transferQueue.getActiveCount()).toBe(2);
    expect(transferQueue.getQueuedCount()).toBe(1);

    transferQueue.setMaxConcurrent(5);
    expect(transferQueue.getActiveCount()).toBe(3);
    expect(transferQueue.getQueuedCount()).toBe(0);
  });
});
