import type { TransferType } from '@shared/types/transfer';
import { getApi } from '@/services/api';
import { useTransferStore } from '@/stores/transfer-store';

export interface EnqueueTransferParams {
  type: TransferType;
  sessionId: string;
  localPath: string;
  remotePath: string;
  fileName: string;
  /** Best-known size in bytes; progress events correct it once the transfer starts. */
  size: number;
}

/**
 * Start a transfer in main *and* register it in the renderer's queue.
 *
 * Both halves are required: progress/complete/error events for an id the
 * transfer store has never seen are dropped. Folder Sync called the IPC and
 * discarded the returned id, so its transfers ran invisibly — no progress, no
 * completion, no way to cancel. Going through one function keeps the two from
 * drifting apart again.
 */
export async function enqueueTransfer(params: EnqueueTransferParams): Promise<string> {
  const { type, sessionId, localPath, remotePath, fileName, size } = params;
  const transferId = await getApi().storage[type]({ sessionId, localPath, remotePath });
  useTransferStore.getState().addTransfer({
    id: transferId,
    type,
    localPath,
    remotePath,
    fileName,
    size,
    transferred: 0,
    status: 'queued',
    bytesPerSec: 0,
    sessionId,
  });
  return transferId;
}
