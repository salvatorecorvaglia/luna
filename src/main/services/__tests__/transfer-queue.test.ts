import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@shared/constants';
import { transferQueue } from '../transfer-queue';

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
  };
  q.queue.length = 0;
  q.active.clear();
}

beforeEach(() => {
  resetQueue();
  // Concurrency 1 so only one moves to active and the rest pile up in queue.
  transferQueue.setMaxConcurrent(1);
});

describe('transferQueue', () => {
  it('returns the same id for duplicate enqueues', async () => {
    const a = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x');
    const b = await transferQueue.enqueue('upload', 'sess', '/local/x', '/remote/x');
    expect(a).toBe(b);
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
