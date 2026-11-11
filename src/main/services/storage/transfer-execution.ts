import { IPC } from '@shared/constants';
import type { TransferType } from '@shared/types/transfer';
import { classifyTransferError } from '../../lib/error-map';
import { AbortError } from '../../lib/errors';
import { emitToRenderer } from '../emit';
import { storageRegistry } from './registry';

export interface TransferExecution {
  id: string;
  type: TransferType;
  sessionId: string;
  localPath: string;
  remotePath: string;
  size: number;
  controller: AbortController;
  lastEmitTime: number;
  lastTransferred: number;
}

/** Owns progress and the single terminal outcome; the queue retains claims through settlement. */
export async function executeTransfer(transfer: TransferExecution): Promise<void> {
  const { id, type, sessionId, localPath, remotePath, controller } = transfer;

  try {
    const onStep = (transferred: number, _chunk: number, total: number): void => {
      if (controller.signal.aborted) return;
      const now = Date.now();
      const elapsed = (now - transfer.lastEmitTime) / 1000;
      if (elapsed >= 0.2) {
        const delta = transferred - transfer.lastTransferred;
        const bytesPerSec = Math.round(delta / elapsed);
        transfer.lastEmitTime = now;
        transfer.lastTransferred = transferred;

        if (transfer.size === 0 && total > 0) {
          transfer.size = total;
        }

        emitToRenderer(IPC.TRANSFER_PROGRESS, {
          transferId: id,
          transferred,
          total: transfer.size || total,
          bytesPerSec,
        });
      }
    };

    const provider = storageRegistry.require(sessionId);
    if (type === 'download') {
      await provider.streamDownload(sessionId, remotePath, localPath, onStep, controller.signal);
    } else {
      await provider.streamUpload(sessionId, localPath, remotePath, onStep, controller.signal);
    }

    // Flush a final 100% progress event so the UI lands on full before
    // TRANSFER_COMPLETE — the 200ms throttle in onStep frequently swallows
    // the last chunk, leaving the bar stuck just below total.
    const finalTotal = transfer.size || transfer.lastTransferred;
    if (finalTotal > 0) {
      emitToRenderer(IPC.TRANSFER_PROGRESS, {
        transferId: id,
        transferred: finalTotal,
        total: finalTotal,
        bytesPerSec: 0,
      });
    }

    emitToRenderer(IPC.TRANSFER_COMPLETE, { transferId: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Transfer failed';
    if (controller.signal.aborted || err instanceof AbortError) {
      emitToRenderer(IPC.TRANSFER_CANCELLED, { transferId: id });
    } else {
      emitToRenderer(IPC.TRANSFER_ERROR, {
        transferId: id,
        error: msg,
        errorClass: classifyTransferError(err),
      });
    }
  }
}
