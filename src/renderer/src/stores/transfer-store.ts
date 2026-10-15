import type { TransferItem } from '@shared/types/transfer';
import { create } from 'zustand';

/** Single progress sample passed to applyProgressBatch. */
export interface ProgressSample {
  transferId: string;
  transferred: number;
  bytesPerSec: number;
}

interface TransferState {
  transfers: Map<string, TransferItem>;
  queueExpanded: boolean;

  addTransfer: (transfer: TransferItem) => void;
  updateProgress: (transferId: string, transferred: number, bytesPerSec: number) => void;
  /**
   * Apply many progress samples in one set() — preferred over calling
   * updateProgress per event so we allocate one new Map per render frame
   * instead of one per byte chunk.
   */
  applyProgressBatch: (samples: Iterable<ProgressSample>) => void;
  completeTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
  errorTransfer: (
    transferId: string,
    error: string,
    errorClass?: import('@shared/types/transfer').TransferErrorClass,
  ) => void;
  removeTransfer: (transferId: string) => void;
  clearCompleted: () => void;
  setQueueExpanded: (expanded: boolean) => void;
  toggleQueueExpanded: () => void;
}

/**
 * How long terminal-state transfers (completed/cancelled/error) stay in the
 * store before being auto-removed. Without this the map grew unbounded over
 * a long session — the only previous reaper was the manual "clear completed"
 * button. 5 minutes is enough for a user to notice + retry, short enough
 * that idle UIs reclaim memory.
 */
const TERMINAL_RETENTION_MS = 5 * 60 * 1000;

/** Hard cap on retained terminal-state transfers — guards against bursts. */
const MAX_RETAINED_TERMINAL = 200;

/**
 * Pending reaper timers, so they can be cancelled.
 *
 * These used to be bare setTimeout calls with no handle kept, which meant a
 * burst of 200 completions left 200 live five-minute timers that nothing could
 * cancel — `clearCompleted()` dropped the rows and the timers still fired
 * afterwards (harmlessly, since removal is idempotent, but unboundedly).
 */
const autoRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoRemove(transferId: string, remove: (id: string) => void): void {
  cancelAutoRemove(transferId);
  const timer = setTimeout(() => {
    autoRemoveTimers.delete(transferId);
    remove(transferId);
  }, TERMINAL_RETENTION_MS);
  autoRemoveTimers.set(transferId, timer);
}

function cancelAutoRemove(transferId: string): void {
  const timer = autoRemoveTimers.get(transferId);
  if (timer !== undefined) {
    clearTimeout(timer);
    autoRemoveTimers.delete(transferId);
  }
}

/**
 * Drop the oldest terminal-state transfers until the count is within
 * MAX_RETAINED_TERMINAL. Active/queued transfers are never evicted —
 * only completed/cancelled/error rows count against the cap.
 */
function evictOldestTerminal(transfers: Map<string, TransferItem>): void {
  const terminalIds: string[] = [];
  for (const [id, item] of transfers) {
    if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'error') {
      terminalIds.push(id);
    }
  }
  // Map preserves insertion order — older entries are at the front.
  while (terminalIds.length > MAX_RETAINED_TERMINAL) {
    const id = terminalIds.shift();
    if (id) {
      transfers.delete(id);
      // The row is gone; its reaper would only fire into nothing.
      cancelAutoRemove(id);
    }
  }
}

export const useTransferStore = create<TransferState>((set, get) => {
  const finishTransfer = (transferId: string, next: (item: TransferItem) => TransferItem): void => {
    const item = get().transfers.get(transferId);
    if (!item) return;
    set((s) => {
      const transfers = new Map(s.transfers);
      transfers.set(transferId, next(item));
      evictOldestTerminal(transfers);
      return { transfers };
    });
    if (get().transfers.has(transferId)) {
      scheduleAutoRemove(transferId, (id) => get().removeTransfer(id));
    }
  };

  return {
    transfers: new Map(),
    queueExpanded: false,

    addTransfer: (transfer) =>
      set((s) => {
        const transfers = new Map(s.transfers);
        transfers.set(transfer.id, transfer);
        return { transfers, queueExpanded: true };
      }),

    updateProgress: (transferId, transferred, bytesPerSec) =>
      set((s) => {
        const transfers = new Map(s.transfers);
        const item = transfers.get(transferId);
        if (item) {
          transfers.set(transferId, { ...item, transferred, bytesPerSec, status: 'active' });
        }
        return { transfers };
      }),

    applyProgressBatch: (samples) =>
      set((s) => {
        let mutated = false;
        let transfers = s.transfers;
        for (const sample of samples) {
          const item = transfers.get(sample.transferId);
          if (!item) continue;
          // Skip late progress samples that arrive after a terminal status
          // (completed/error/cancelled) — without this guard a stray sample
          // would regress the status back to 'active' and the UI would show
          // the transfer as still in flight.
          if (
            item.status === 'completed' ||
            item.status === 'error' ||
            item.status === 'cancelled'
          ) {
            continue;
          }
          if (!mutated) {
            // Only allocate a new Map once we know there's at least one matching
            // transfer — empty/no-op batches don't trigger a re-render.
            transfers = new Map(s.transfers);
            mutated = true;
          }
          transfers.set(sample.transferId, {
            ...item,
            transferred: sample.transferred,
            bytesPerSec: sample.bytesPerSec,
            status: 'active',
          });
        }
        return mutated ? { transfers } : s;
      }),

    // The three terminal transitions share one shape. Events for a row the
    // store doesn't have (already removed, or never registered) used to allocate
    // a fresh Map — waking every subscriber — and arm a reaper for nothing.
    completeTransfer: (transferId) =>
      finishTransfer(transferId, (item) => ({
        ...item,
        status: 'completed',
        transferred: item.size,
        bytesPerSec: 0,
      })),

    cancelTransfer: (transferId) =>
      finishTransfer(transferId, (item) => ({ ...item, status: 'cancelled', bytesPerSec: 0 })),

    errorTransfer: (transferId, error, errorClass) =>
      finishTransfer(transferId, (item) => ({
        ...item,
        status: 'error',
        error,
        errorClass,
        bytesPerSec: 0,
      })),

    removeTransfer: (transferId) => {
      // Drop any pending reaper for this row: it has been removed by hand, so the
      // timer has nothing left to do.
      cancelAutoRemove(transferId);
      set((s) => {
        if (!s.transfers.has(transferId)) return s;
        const transfers = new Map(s.transfers);
        transfers.delete(transferId);
        return { transfers };
      });
    },

    clearCompleted: () =>
      set((s) => {
        const transfers = new Map(s.transfers);
        for (const [id, item] of transfers) {
          if (
            item.status === 'completed' ||
            item.status === 'error' ||
            item.status === 'cancelled'
          ) {
            transfers.delete(id);
            // The row is gone; its five-minute reaper would otherwise stay armed.
            cancelAutoRemove(id);
          }
        }
        return { transfers };
      }),

    setQueueExpanded: (expanded) => set({ queueExpanded: expanded }),
    toggleQueueExpanded: () => set((s) => ({ queueExpanded: !s.queueExpanded })),
  };
});
