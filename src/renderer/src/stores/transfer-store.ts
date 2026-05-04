import {create} from 'zustand'
import type {TransferItem} from '@shared/types/transfer'

interface TransferState {
  transfers: Map<string, TransferItem>
  queueExpanded: boolean

  addTransfer: (transfer: TransferItem) => void
  updateProgress: (transferId: string, transferred: number, bytesPerSec: number) => void
  completeTransfer: (transferId: string) => void
  cancelTransfer: (transferId: string) => void
  errorTransfer: (transferId: string, error: string) => void
  removeTransfer: (transferId: string) => void
  clearCompleted: () => void
  setQueueExpanded: (expanded: boolean) => void
  toggleQueueExpanded: () => void
}

export const useTransferStore = create<TransferState>((set) => ({
  transfers: new Map(),
  queueExpanded: false,

  addTransfer: (transfer) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      transfers.set(transfer.id, transfer)
      return { transfers, queueExpanded: true }
    }),

  updateProgress: (transferId, transferred, bytesPerSec) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      const item = transfers.get(transferId)
      if (item) {
        transfers.set(transferId, { ...item, transferred, bytesPerSec, status: 'active' })
      }
      return { transfers }
    }),

  completeTransfer: (transferId) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      const item = transfers.get(transferId)
      if (item) {
        transfers.set(transferId, {
          ...item,
          status: 'completed',
          transferred: item.size,
          bytesPerSec: 0
        })
      }
      return { transfers }
    }),

  cancelTransfer: (transferId) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      const item = transfers.get(transferId)
      if (item) {
        transfers.set(transferId, { ...item, status: 'cancelled', bytesPerSec: 0 })
      }
      return { transfers }
    }),

  errorTransfer: (transferId, error) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      const item = transfers.get(transferId)
      if (item) {
        transfers.set(transferId, { ...item, status: 'error', error, bytesPerSec: 0 })
      }
      return { transfers }
    }),

  removeTransfer: (transferId) =>
    set((s) => {
      const transfers = new Map(s.transfers)
      transfers.delete(transferId)
      return { transfers }
    }),

  clearCompleted: () =>
    set((s) => {
      const transfers = new Map(s.transfers)
      for (const [id, item] of transfers) {
        if (item.status === 'completed' || item.status === 'error' || item.status === 'cancelled') {
          transfers.delete(id)
        }
      }
      return { transfers }
    }),

  setQueueExpanded: (expanded) => set({ queueExpanded: expanded }),
  toggleQueueExpanded: () => set((s) => ({ queueExpanded: !s.queueExpanded }))
}))
