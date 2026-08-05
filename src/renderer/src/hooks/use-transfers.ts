import { useEffect, useRef } from 'react';
import { useInvalidateLocalDir, useInvalidateSftp } from '@/hooks/use-sftp';
import { getApi } from '@/services/api';
import { type ProgressSample, useTransferStore } from '@/stores/transfer-store';

/**
 * Return the parent directory of a forward-slash path. Handles both POSIX
 * and Windows-flavored separators since localPath may be either. Returns
 * `undefined` when there's no meaningful parent (root or empty), so callers
 * fall back to broad invalidation rather than invalidating bogus paths.
 */
function parentDir(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const normalized = p.replace(/\\+/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  if (slash <= 0) return slash === 0 ? '/' : undefined;
  return normalized.slice(0, slash);
}

/**
 * Subscribes to IPC transfer events (progress, complete, error) and
 * routes them into the Zustand transfer store. Also invalidates
 * SFTP/local directory caches on transfer completion.
 *
 * Mount this once at the app level so events are always captured.
 */
export function useTransferEventListener(): void {
  const applyProgressBatch = useTransferStore((s) => s.applyProgressBatch);
  const completeTransfer = useTransferStore((s) => s.completeTransfer);
  const errorTransfer = useTransferStore((s) => s.errorTransfer);
  const cancelTransfer = useTransferStore((s) => s.cancelTransfer);
  const invalidateSftp = useInvalidateSftp();
  const invalidateLocal = useInvalidateLocalDir();
  // Progress events arrive ~5/s per transfer from the main process. With
  // multiple concurrent transfers each event would otherwise allocate a fresh
  // Map and trigger a render. Coalesce into a single rAF flush so the store
  // sees one batched update per frame, regardless of how many transfers fire.
  const pending = useRef<Map<string, ProgressSample>>(new Map());
  const rafHandle = useRef<number | null>(null);

  useEffect(() => {
    const flush = (): void => {
      rafHandle.current = null;
      if (pending.current.size === 0) return;
      const batch = pending.current;
      pending.current = new Map();
      applyProgressBatch(batch.values());
    };
    /**
     * Drop any pending progress sample for `transferId` and cancel a
     * scheduled flush if it would have been the only sample. Called before
     * applying a terminal event (complete/error/cancel) so a queued progress
     * frame can't land *after* the terminal status and revive the row.
     */
    const dropPending = (transferId: string): void => {
      pending.current.delete(transferId);
      if (pending.current.size === 0 && rafHandle.current !== null) {
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = null;
      }
    };
    const cleanupProgress = getApi().transfers.onProgress((event) => {
      pending.current.set(event.transferId, {
        transferId: event.transferId,
        transferred: event.transferred,
        bytesPerSec: event.bytesPerSec,
      });
      if (rafHandle.current === null) {
        rafHandle.current = requestAnimationFrame(flush);
      }
    });

    const cleanupComplete = getApi().transfers.onComplete((event) => {
      const transfer = useTransferStore.getState().transfers.get(event.transferId);
      const sessionId = transfer?.sessionId;
      dropPending(event.transferId);
      completeTransfer(event.transferId);
      // Only invalidate the directories actually touched by this transfer.
      // Previously every transfer dropped *all* cached directories for the
      // session, which forced a fresh `list` on every open pane.
      if (sessionId) {
        invalidateSftp(sessionId, parentDir(transfer?.remotePath));
      }
      invalidateLocal(parentDir(transfer?.localPath));
    });

    const cleanupError = getApi().transfers.onError((event) => {
      dropPending(event.transferId);
      errorTransfer(event.transferId, event.error, event.errorClass);
    });

    const cleanupCancelled = getApi().transfers.onCancelled((event) => {
      const transfer = useTransferStore.getState().transfers.get(event.transferId);
      const sessionId = transfer?.sessionId;
      dropPending(event.transferId);
      cancelTransfer(event.transferId);
      if (sessionId) invalidateSftp(sessionId, parentDir(transfer?.remotePath));
      invalidateLocal(parentDir(transfer?.localPath));
    });

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      cleanupProgress();
      cleanupComplete();
      cleanupError();
      cleanupCancelled();
      if (rafHandle.current !== null) {
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = null;
      }
      pending.current.clear();
    };
  }, [
    applyProgressBatch,
    completeTransfer,
    errorTransfer,
    cancelTransfer,
    invalidateSftp,
    invalidateLocal,
  ]);
}

/**
 * Cancel a transfer by ID. Delegates to main process.
 */
export function cancelTransfer(transferId: string): void {
  void getApi().transfers.cancel(transferId);
}
