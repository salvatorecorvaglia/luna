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

function scheduleAutoRemove(transferId: string, remove: (id: string) => void): void {
  setTimeout(() => remove(transferId), TERMINAL_RETENTION_MS);
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
    if (id) transfers.delete(id);
  }
}

export const useTransferStore = create<TransferState>((set, get) => ({
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
        if (item.status === 'completed' || item.status === 'error' || item.status === 'cancelled') {
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

  completeTransfer: (transferId) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const item = transfers.get(transferId);
      if (item) {
        transfers.set(transferId, {
          ...item,
          status: 'completed',
          transferred: item.size,
          bytesPerSec: 0,
        });
        evictOldestTerminal(transfers);
      }
      return { transfers };
    });
    scheduleAutoRemove(transferId, (id) => get().removeTransfer(id));
  },

  cancelTransfer: (transferId) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const item = transfers.get(transferId);
      if (item) {
        transfers.set(transferId, { ...item, status: 'cancelled', bytesPerSec: 0 });
        evictOldestTerminal(transfers);
      }
      return { transfers };
    });
    scheduleAutoRemove(transferId, (id) => get().removeTransfer(id));
  },

  errorTransfer: (transferId, error, errorClass) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const item = transfers.get(transferId);
      if (item) {
        transfers.set(transferId, {
          ...item,
          status: 'error',
          error,
          errorClass,
          bytesPerSec: 0,
        });
        evictOldestTerminal(transfers);
      }
      return { transfers };
    });
    scheduleAutoRemove(transferId, (id) => get().removeTransfer(id));
  },

  removeTransfer: (transferId) =>
    set((s) => {
      const transfers = new Map(s.transfers);
      transfers.delete(transferId);
      return { transfers };
    }),

  clearCompleted: () =>
    set((s) => {
      const transfers = new Map(s.transfers);
      for (const [id, item] of transfers) {
        if (item.status === 'completed' || item.status === 'error' || item.status === 'cancelled') {
          transfers.delete(id);
        }
      }
      return { transfers };
    }),

  setQueueExpanded: (expanded) => set({ queueExpanded: expanded }),
  toggleQueueExpanded: () => set((s) => ({ queueExpanded: !s.queueExpanded })),
}));
