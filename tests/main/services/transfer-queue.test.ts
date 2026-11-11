import { stat as fsStat } from 'node:fs/promises';
import { IPC, LIMITS } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitToRenderer } from '../../../src/main/services/emit';
import { TransferQueue } from '../../../src/main/services/transfer-queue';

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
vi.mock('../../../src/main/services/storage/registry', () => ({
  storageRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(() => stubProvider),
    require: vi.fn(() => stubProvider),
    kindOf: vi.fn(() => 'sftp'),
  },
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 0 }),
}));

vi.mock('../../../src/main/services/emit', () => ({
  emitToRenderer: vi.fn(),
}));

let transferQueue: TransferQueue;

beforeEach(() => {
  transferQueue = new TransferQueue();
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
    await expect(transferQueue.enqueue('upload', 'sess', '/l2', '/r')).rejects.toThrow(
      /already writing/,
    );
    const otherRemote = await transferQueue.enqueue('upload', 'sess', '/l', '/r2');
    const ids = new Set([upload, download, otherSession, otherRemote]);
    expect(ids.size).toBe(4);
  });

  it('dedups concurrent enqueues that race through the stat() await', async () => {
    // Regression: enqueue() reserves the dedup key synchronously before the
    // stat() await. Without that reservation, two concurrent calls both pass
    // the dedup check, both await stat, and both push duplicate transfers.
    let releaseStat: ((value: { size: number }) => void) | undefined;
    const pendingStat = new Promise<{ size: number }>((resolve) => {
      releaseStat = resolve;
    });
    (fsStat as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(
      pendingStat,
    );

    const first = transferQueue.enqueue('upload', 'sess', '/dup', '/dup-r');
    // Yield so the first call enters stat() and reserves the dedup key.
    await Promise.resolve();
    const second = transferQueue.enqueue('upload', 'sess', '/dup', '/dup-r');

    releaseStat!({ size: 0 });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(transferQueue.getActiveCount() + transferQueue.getQueuedCount()).toBe(1);
  });

  it('cancel during the enqueue stat() window prevents the transfer from running', async () => {
    // Regression: cancel(id) used to silently no-op while enqueue() was
    // awaiting stat(), because the controller and queue entry didn't exist
    // yet. The transfer then started running after stat() resolved, ignoring
    // the user's cancel. Fix: pre-allocate the AbortController so cancel()
    // can abort the reserved transfer; enqueue() honours the abort post-await
    // by rejecting instead of pushing to the queue.
    let releaseStat: ((value: { size: number }) => void) | undefined;
    const pendingStat = new Promise<{ size: number }>((resolve) => {
      releaseStat = resolve;
    });
    (fsStat as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(
      pendingStat,
    );

    const reservedId = '00000000-0000-4000-8000-000000000001';
    const inflight = transferQueue.enqueue('upload', 'sess', '/race', '/race-r', reservedId);
    // Let enqueue() reach the stat() await and reserve the id.
    await Promise.resolve();
    await Promise.resolve();

    transferQueue.cancel(reservedId);
    releaseStat!({ size: 0 });

    // enqueue() rejects rather than resolving with the id. The caller does not
    // have the id yet, so a TRANSFER_CANCELLED event fired here would arrive
    // before the renderer has a row to apply it to — and the row it creates
    // afterwards would sit at "queued" forever. Rejecting is the only signal
    // the caller can actually observe.
    await expect(inflight).rejects.toThrow(/cancelled before it started/);

    expect(transferQueue.getActiveCount()).toBe(0);
    expect(transferQueue.getQueuedCount()).toBe(0);
    expect(stubProvider.streamUpload).not.toHaveBeenCalled();
    // No ghost event for a transfer the renderer never learned about.
    expect(emitsOf(IPC.TRANSFER_CANCELLED)).toHaveLength(0);
  });

  it('aborts reservations still inside the stat() window on cancelAll', async () => {
    // Reserved transfers live in neither `queue` nor `active`, so a cancelAll
    // that only drained those let a transfer reserved during shutdown start
    // afterwards — precisely the window the reservation exists to cover.
    let releaseStat: ((stats: { size: number }) => void) | undefined;
    (fsStat as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(
      new Promise<{ size: number }>((resolve) => {
        releaseStat = resolve;
      }),
    );

    const inflight = transferQueue.enqueue('upload', 'sess', '/quit', '/quit-r');
    await Promise.resolve();
    await Promise.resolve();

    transferQueue.cancelAll();
    releaseStat!({ size: 0 });

    await expect(inflight).rejects.toThrow(/cancelled before it started/);
    expect(stubProvider.streamUpload).not.toHaveBeenCalled();
    expect(transferQueue.getTotalCount()).toBe(0);
  });

  it('aborts reservations for a disconnecting session', async () => {
    let releaseStat: ((stats: { size: number }) => void) | undefined;
    (fsStat as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(
      new Promise<{ size: number }>((resolve) => {
        releaseStat = resolve;
      }),
    );

    const inflight = transferQueue.enqueue('upload', 'doomed', '/l', '/r');
    await Promise.resolve();
    await Promise.resolve();

    transferQueue.cancelBySession('doomed');
    releaseStat!({ size: 0 });

    await expect(inflight).rejects.toThrow(/cancelled before it started/);
    expect(stubProvider.streamUpload).not.toHaveBeenCalled();
  });

  it('leaves reservations for other sessions alone', async () => {
    let releaseStat: ((stats: { size: number }) => void) | undefined;
    (fsStat as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(
      new Promise<{ size: number }>((resolve) => {
        releaseStat = resolve;
      }),
    );

    const inflight = transferQueue.enqueue('upload', 'keeper', '/l', '/r');
    await Promise.resolve();
    await Promise.resolve();

    transferQueue.cancelBySession('some-other-session');
    releaseStat!({ size: 0 });

    await expect(inflight).resolves.toBeTypeOf('string');
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

  it('cancelAll clears queued transfers but retains active ownership until cleanup', async () => {
    await transferQueue.enqueue('upload', 'sess', '/local/active', '/remote/active');
    await transferQueue.enqueue('upload', 'sess', '/local/q1', '/remote/q1');
    await transferQueue.enqueue('upload', 'sess', '/local/q2', '/remote/q2');

    expect(transferQueue.getActiveCount()).toBe(1);
    expect(transferQueue.getQueuedCount()).toBe(2);

    transferQueue.cancelAll();

    expect(transferQueue.getActiveCount()).toBe(1);
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
      expect(errs[0]!.errorClass).toBe('permission');
    });

    it('emits TRANSFER_ERROR with errorClass=disk-full on ENOSPC', async () => {
      stubProvider.streamDownload.mockRejectedValueOnce(diskFullError());
      await transferQueue.enqueue('download', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const errs = emitsOf(IPC.TRANSFER_ERROR) as { errorClass: string }[];
      expect(errs).toHaveLength(1);
      expect(errs[0]!.errorClass).toBe('disk-full');
    });

    it('emits TRANSFER_ERROR with errorClass=connection on ECONNRESET', async () => {
      stubProvider.streamDownload.mockRejectedValueOnce(connectionResetError());
      await transferQueue.enqueue('download', 'sess', '/l', '/r');
      await new Promise((r) => setTimeout(r, 0));
      const errs = emitsOf(IPC.TRANSFER_ERROR) as { errorClass: string }[];
      expect(errs).toHaveLength(1);
      expect(errs[0]!.errorClass).toBe('connection');
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
      // Non-null: onStep(500, 500, 1000) above guarantees at least one emit.
      const last = progress[progress.length - 1]!;
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

describe('download destination exclusivity', () => {
  /**
   * The dedup key is (type, session, localPath, remotePath), so two downloads
   * of *different* remote files to the *same* local path were two distinct
   * transfers and both ran. They then both wrote `${localPath}.luna-partial`
   * and both renamed it over the destination — interleaved writes into one
   * temp file, then a coin flip over whose content survived. The atomic rename
   * that exists to prevent corruption is what hid it: the result always looked
   * like a complete file.
   *
   * pipe-transfer.ts documents this exclusivity as the reason its temp-file
   * name can safely be a constant, so it has to actually hold.
   */
  it('refuses a second download heading for a local path already claimed', async () => {
    await transferQueue.enqueue('download', 'sess', '/local/same', '/remote/one');

    await expect(
      transferQueue.enqueue('download', 'sess', '/local/same', '/remote/two'),
    ).rejects.toThrow(/already writing to \/local\/same/);
  });

  it('holds the local path while a cancelled download is still unwinding', async () => {
    const first = await transferQueue.enqueue('download', 'sess', '/local/reuse', '/remote/one');
    transferQueue.cancel(first);

    await expect(
      transferQueue.enqueue('download', 'sess', '/local/reuse', '/remote/two'),
    ).rejects.toThrow(/already writing/);
  });

  it('does not constrain uploads, which read the local path rather than write it', async () => {
    await transferQueue.enqueue('upload', 'sess', '/local/src', '/remote/a');
    await expect(
      transferQueue.enqueue('upload', 'sess', '/local/src', '/remote/b'),
    ).resolves.toBeTruthy();
  });

  it('still dedupes an identical download to one transfer', async () => {
    const a = await transferQueue.enqueue('download', 'sess', '/local/dup', '/remote/dup');
    const b = await transferQueue.enqueue('download', 'sess', '/local/dup', '/remote/dup');
    expect(b).toBe(a);
  });
});

describe('transfer ownership through teardown', () => {
  it('holds an upload destination during session cancellation and releases it after cleanup', async () => {
    let finish!: () => void;
    stubProvider.streamUpload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = await transferQueue.enqueue('upload', 'sess', '/source/a', '/dest/file');
    transferQueue.cancelBySession('sess');
    await expect(
      transferQueue.enqueue('upload', 'sess', '/source/b', '/dest/file'),
    ).rejects.toThrow(/already writing/);
    // A provider that committed before seeing cancel reports completion only.
    expect(emitsOf(IPC.TRANSFER_CANCELLED)).toHaveLength(0);
    finish();
    await transferQueue.waitForIdle();
    expect(emitsOf(IPC.TRANSFER_COMPLETE)).toEqual([{ transferId: first }]);
    expect(emitsOf(IPC.TRANSFER_CANCELLED)).toHaveLength(0);
    await expect(
      transferQueue.enqueue('upload', 'sess', '/source/b', '/dest/file'),
    ).resolves.toBeTruthy();
  });

  it('cancelAll retains download ownership and capacity until cleanup rejects', async () => {
    let fail!: (error: Error) => void;
    stubProvider.streamDownload.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const first = await transferQueue.enqueue('download', 'sess', '/target', '/remote/a');
    transferQueue.cancelAll();
    await expect(transferQueue.enqueue('download', 'sess', '/target', '/remote/b')).rejects.toThrow(
      /already writing/,
    );
    expect(transferQueue.getActiveCount()).toBe(1);
    expect(emitsOf(IPC.TRANSFER_CANCELLED)).toHaveLength(0);
    fail(new Error('aborted after cleanup'));
    await transferQueue.waitForIdle();
    expect(transferQueue.getActiveCount()).toBe(0);
    expect(emitsOf(IPC.TRANSFER_CANCELLED)).toEqual([{ transferId: first }]);
    expect(emitsOf(IPC.TRANSFER_COMPLETE)).toHaveLength(0);
    await expect(
      transferQueue.enqueue('download', 'sess', '/target', '/remote/b'),
    ).resolves.toBeTruthy();
  });

  it('waitForIdle includes cancelled reservations still awaiting stat', async () => {
    let release!: (value: { size: number }) => void;
    (fsStat as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce(
      new Promise<{ size: number }>((resolve) => {
        release = resolve;
      }),
    );
    const pending = transferQueue.enqueue('upload', 'sess', '/source', '/dest');
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    transferQueue.cancelAll();
    let idle = false;
    const drained = transferQueue.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    release({ size: 1 });
    await rejected;
    await drained;
    expect(idle).toBe(true);
  });

  it('reserves upload destinations before stat resolves, including normalized SFTP paths', async () => {
    let release!: (value: { size: number }) => void;
    (fsStat as unknown as { mockReturnValueOnce: (value: unknown) => void }).mockReturnValueOnce(
      new Promise<{ size: number }>((resolve) => {
        release = resolve;
      }),
    );
    const first = transferQueue.enqueue('upload', 'sess', '/source/a', '/dest/sub/../file');
    await expect(
      transferQueue.enqueue('upload', 'sess', '/source/b', '/dest/file'),
    ).rejects.toThrow(/already writing/);
    release({ size: 1 });
    await first;
  });
});

describe('renderer-chosen transfer IDs', () => {
  it('preserves the supplied ID and rejects active or completed ID reuse', async () => {
    const id = '00000000-0000-4000-8000-000000000111';
    stubProvider.streamUpload.mockResolvedValueOnce(undefined);
    expect(await transferQueue.enqueue('upload', 'sess', '/source', '/dest', id)).toBe(id);
    await transferQueue.waitForIdle();
    expect(emitsOf(IPC.TRANSFER_COMPLETE)).toEqual([{ transferId: id }]);
    await expect(transferQueue.enqueue('upload', 'sess', '/other', '/other', id)).rejects.toThrow(
      /id already used/,
    );
  });
  it('rejects a second ID for the same active operation without returning a mismatched ID', async () => {
    await transferQueue.enqueue(
      'upload',
      'sess',
      '/source',
      '/dest',
      '00000000-0000-4000-8000-000000000222',
    );
    await expect(
      transferQueue.enqueue(
        'upload',
        'sess',
        '/source',
        '/dest',
        '00000000-0000-4000-8000-000000000333',
      ),
    ).rejects.toThrow(/already queued/);
  });
});
