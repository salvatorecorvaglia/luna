// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelTransfer, useTransferEventListener } from '../use-transfers';

const applyProgressBatch = vi.fn();
const completeTransfer = vi.fn();
const errorTransfer = vi.fn();
const cancelTransferAction = vi.fn();
const transfersMap = new Map<string, { sessionId?: string }>();

vi.mock('@/stores/transfer-store', () => {
  // Zustand-style hook: callable with a selector AND has getState().
  function useTransferStore<T>(selector: (s: unknown) => T): T {
    return selector({
      applyProgressBatch,
      completeTransfer,
      errorTransfer,
      cancelTransfer: cancelTransferAction,
    });
  }
  (useTransferStore as unknown as { getState: () => unknown }).getState = () => ({
    transfers: transfersMap,
  });
  return { useTransferStore };
});

const invalidateSftp = vi.fn();
const invalidateLocal = vi.fn();
vi.mock('@/hooks/use-sftp', () => ({
  useInvalidateSftp: () => invalidateSftp,
  useInvalidateLocalDir: () => invalidateLocal,
}));

// Captured IPC subscriptions
type Cb<T> = (e: T) => void;
let onProgressCb: Cb<{ transferId: string; transferred: number; bytesPerSec: number }> | null =
  null;
let onCompleteCb: Cb<{ transferId: string }> | null = null;
let onErrorCb: Cb<{ transferId: string; error: string }> | null = null;
let onCancelledCb: Cb<{ transferId: string }> | null = null;

const cleanupProgress = vi.fn();
const cleanupComplete = vi.fn();
const cleanupError = vi.fn();
const cleanupCancelled = vi.fn();
const cancel = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  applyProgressBatch.mockClear();
  completeTransfer.mockClear();
  errorTransfer.mockClear();
  cancelTransferAction.mockClear();
  invalidateSftp.mockClear();
  invalidateLocal.mockClear();
  cleanupProgress.mockClear();
  cleanupComplete.mockClear();
  cleanupError.mockClear();
  cleanupCancelled.mockClear();
  cancel.mockClear();
  onProgressCb = onCompleteCb = onErrorCb = onCancelledCb = null;
  transfersMap.clear();

  Object.assign(window, {
    api: {
      transfers: {
        cancel,
        onProgress: (cb: typeof onProgressCb) => {
          onProgressCb = cb;
          return cleanupProgress;
        },
        onComplete: (cb: typeof onCompleteCb) => {
          onCompleteCb = cb;
          return cleanupComplete;
        },
        onError: (cb: typeof onErrorCb) => {
          onErrorCb = cb;
          return cleanupError;
        },
        onCancelled: (cb: typeof onCancelledCb) => {
          onCancelledCb = cb;
          return cleanupCancelled;
        },
      },
    },
  });

  // Synchronous rAF so we can assert flush behaviour without timers.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe('useTransferEventListener', () => {
  it('subscribes to all four transfer events on mount', () => {
    renderHook(() => useTransferEventListener());
    expect(onProgressCb).toBeTruthy();
    expect(onCompleteCb).toBeTruthy();
    expect(onErrorCb).toBeTruthy();
    expect(onCancelledCb).toBeTruthy();
  });

  it('flushes a batched progress sample to the store', () => {
    renderHook(() => useTransferEventListener());
    act(() => {
      onProgressCb?.({ transferId: 't1', transferred: 100, bytesPerSec: 50 });
    });
    expect(applyProgressBatch).toHaveBeenCalledTimes(1);
    const samples = Array.from(applyProgressBatch.mock.calls[0][0]);
    expect(samples).toEqual([{ transferId: 't1', transferred: 100, bytesPerSec: 50 }]);
  });

  it('completes a transfer and invalidates the session + local caches', () => {
    transfersMap.set('t1', { sessionId: 's1' });
    renderHook(() => useTransferEventListener());
    act(() => {
      onCompleteCb?.({ transferId: 't1' });
    });
    expect(completeTransfer).toHaveBeenCalledWith('t1');
    expect(invalidateSftp).toHaveBeenCalledWith('s1', undefined);
    expect(invalidateLocal).toHaveBeenCalledWith(undefined);
  });

  it('does not invalidate sftp when transfer has no sessionId', () => {
    renderHook(() => useTransferEventListener());
    act(() => {
      onCompleteCb?.({ transferId: 'unknown' });
    });
    expect(completeTransfer).toHaveBeenCalledWith('unknown');
    expect(invalidateSftp).not.toHaveBeenCalled();
    expect(invalidateLocal).toHaveBeenCalledWith(undefined);
  });

  it('routes errors to errorTransfer with the message', () => {
    renderHook(() => useTransferEventListener());
    act(() => {
      onErrorCb?.({ transferId: 't1', error: 'boom' });
    });
    expect(errorTransfer).toHaveBeenCalledWith('t1', 'boom', undefined);
  });

  it('routes cancellations and invalidates caches', () => {
    transfersMap.set('t1', { sessionId: 's1' });
    renderHook(() => useTransferEventListener());
    act(() => {
      onCancelledCb?.({ transferId: 't1' });
    });
    expect(cancelTransferAction).toHaveBeenCalledWith('t1');
    expect(invalidateSftp).toHaveBeenCalledWith('s1', undefined);
  });

  it('runs every cleanup function on unmount', () => {
    const { unmount } = renderHook(() => useTransferEventListener());
    unmount();
    expect(cleanupProgress).toHaveBeenCalled();
    expect(cleanupComplete).toHaveBeenCalled();
    expect(cleanupError).toHaveBeenCalled();
    expect(cleanupCancelled).toHaveBeenCalled();
  });
});

describe('cancelTransfer (free function)', () => {
  it('delegates to window.api.transfers.cancel', () => {
    cancelTransfer('t9');
    expect(cancel).toHaveBeenCalledWith('t9');
  });
});
