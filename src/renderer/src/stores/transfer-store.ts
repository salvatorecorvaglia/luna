import { create } from 'zustand';
import type { TransferItem } from '@shared/types/transfer';

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
  errorTransfer: (transferId: string, error: string) => void;
  removeTransfer: (transferId: string) => void;
  clearCompleted: () => void;
  setQueueExpanded: (expanded: boolean) => void;
  toggleQueueExpanded: () => void;
}

export const useTransferStore = create<TransferState>((set) => ({
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

  completeTransfer: (transferId) =>
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
      }
      return { transfers };
    }),

  cancelTransfer: (transferId) =>
    set((s) => {
      const transfers = new Map(s.transfers);
      const item = transfers.get(transferId);
      if (item) {
        transfers.set(transferId, { ...item, status: 'cancelled', bytesPerSec: 0 });
      }
      return { transfers };
    }),

  errorTransfer: (transferId, error) =>
    set((s) => {
      const transfers = new Map(s.transfers);
      const item = transfers.get(transferId);
      if (item) {
        transfers.set(transferId, { ...item, status: 'error', error, bytesPerSec: 0 });
      }
      return { transfers };
    }),

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
