import { stat } from 'fs/promises';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IPC, LIMITS } from '@shared/constants';
import type { TransferType } from '@shared/types/transfer';
import { storageRegistry } from './storage/registry';
import { emitToRenderer } from './emit';
import { AbortError } from '../lib/errors';
import { classifyTransferError } from '../lib/error-map';

interface QueuedTransfer {
  id: string;
  type: TransferType;
  sessionId: string;
  localPath: string;
  remotePath: string;
  fileName: string;
  size: number;
  controller: AbortController;
  lastEmitTime: number;
  lastTransferred: number;
}

class TransferQueue {
  private queue: QueuedTransfer[] = [];
  private active = new Map<string, QueuedTransfer>();
  private maxConcurrent = 3;
  /** Re-entrancy guard: only one synchronous dispatch loop at a time. */
  private dispatching = false;

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.min(LIMITS.MAX_CONCURRENT_TRANSFERS, max));
    this.processQueue();
  }

  async enqueue(
    type: TransferType,
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): Promise<string> {
    const isDuplicate = (t: QueuedTransfer): boolean =>
      t.type === type &&
      t.sessionId === sessionId &&
      t.localPath === localPath &&
      t.remotePath === remotePath &&
      !t.controller.signal.aborted;
    const existing =
      this.queue.find(isDuplicate) || Array.from(this.active.values()).find(isDuplicate);
    if (existing) return existing.id;

    if (this.queue.length >= LIMITS.MAX_QUEUED_TRANSFERS) {
      throw new Error(
        `Transfer queue is full (${LIMITS.MAX_QUEUED_TRANSFERS} pending). Wait for transfers to complete or cancel some.`,
      );
    }

    const transferId = uuidv4();
    const fileName = basename(type === 'upload' ? localPath : remotePath);

    let size = 0;
    try {
      if (type === 'upload') {
        const stats = await stat(localPath);
        size = stats.size;
      } else {
        const provider = storageRegistry.require(sessionId);
        size = await provider.statSize(sessionId, remotePath);
      }
    } catch {
      // size will be reported by progress callback
    }

    const transfer: QueuedTransfer = {
      id: transferId,
      type,
      sessionId,
      localPath,
      remotePath,
      fileName,
      size,
      controller: new AbortController(),
      lastEmitTime: Date.now(),
      lastTransferred: 0,
    };

    this.queue.push(transfer);

    emitToRenderer(IPC.TRANSFER_PROGRESS, {
      transferId,
      transferred: 0,
      total: size,
      bytesPerSec: 0,
    });

    this.processQueue();
    return transferId;
  }

  cancel(transferId: string): void {
    const queueIndex = this.queue.findIndex((t) => t.id === transferId);
    if (queueIndex !== -1) {
      const [transfer] = this.queue.splice(queueIndex, 1);
      transfer.controller.abort();
      emitToRenderer(IPC.TRANSFER_CANCELLED, { transferId });
      return;
    }

    const active = this.active.get(transferId);
    if (active) {
      active.controller.abort();
    }
  }

  private processQueue(): void {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
        const transfer = this.queue.shift()!;
        this.active.set(transfer.id, transfer);
        // executeTransfer is async — fire and forget. The finally branch re-enters
        // processQueue() after each completion, but the dispatching flag means
        // re-entrant calls during the loop are absorbed.
        // Wrap in try/catch so a sync throw before the first await can't poison
        // the dispatch loop and leave the slot permanently occupied.
        try {
          this.executeTransfer(transfer).catch((err) => {
            // executeTransfer's own try/catch should swallow everything; this
            // is a last-resort guard against a future change leaking a reject.
            this.active.delete(transfer.id);
            emitToRenderer(IPC.TRANSFER_ERROR, {
              transferId: transfer.id,
              error: err instanceof Error ? err.message : String(err),
              errorClass: classifyTransferError(err),
            });
            this.processQueue();
          });
        } catch (err) {
          this.active.delete(transfer.id);
          emitToRenderer(IPC.TRANSFER_ERROR, {
            transferId: transfer.id,
            error: err instanceof Error ? err.message : String(err),
            errorClass: classifyTransferError(err),
          });
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async executeTransfer(transfer: QueuedTransfer): Promise<void> {
    const { id, type, sessionId, localPath, remotePath, controller } = transfer;

    try {
      const onStep = (transferred: number, _chunk: number, total: number): void => {
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
    } finally {
      this.active.delete(id);
      this.processQueue();
    }
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  getTotalCount(): number {
    return this.active.size + this.queue.length;
  }

  getState(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.active.size,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  cancelAll(): void {
    // Abort every controller, then drop both queues so the AbortController
    // references (and their attached signal listeners) are eligible for GC
    // immediately rather than waiting for the per-transfer finally branch
    // to clean them up — which won't run if the SFTP channel is already
    // dead and the abort handler never settles.
    for (const transfer of this.active.values()) {
      transfer.controller.abort();
    }
    for (const transfer of this.queue) {
      transfer.controller.abort();
      emitToRenderer(IPC.TRANSFER_CANCELLED, { transferId: transfer.id });
    }
    this.active.clear();
    this.queue = [];
  }

  cancelBySession(sessionId: string): void {
    const toCancel: string[] = [];
    for (const t of this.queue) {
      if (t.sessionId === sessionId) toCancel.push(t.id);
    }
    for (const t of this.active.values()) {
      if (t.sessionId === sessionId) toCancel.push(t.id);
    }
    for (const id of toCancel) this.cancel(id);
  }
}

export const transferQueue = new TransferQueue();
