import { stat } from 'fs/promises';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { IPC, LIMITS } from '@shared/constants';
import type { TransferType } from '@shared/types/transfer';
import { storageRegistry } from './storage/registry';
import { emitToRenderer } from './emit';
import { AbortError } from '../lib/errors';
import { classifyTransferError } from '../lib/error-map';
import log from '../lib/logger';

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
  /**
   * Dedup index: maps `${type}|${sessionId}|${localPath}|${remotePath}` →
   * transfer id, populated for both queued and active entries. Replaces a
   * linear scan across both collections on every enqueue() so a burst of
   * thousands of identical requests stays O(n) total instead of O(n²).
   */
  private dedupIndex = new Map<string, string>();
  /**
   * Transfer ids that have reserved a dedup key but haven't been pushed to
   * `queue` yet (because enqueue() is awaiting stat()). A concurrent enqueue()
   * with the same key must treat these as live, not stale — otherwise both
   * callers race past the dedup check and create duplicate transfers.
   */
  private reserved = new Set<string>();
  private maxConcurrent = 3;
  /** Re-entrancy guard: only one synchronous dispatch loop at a time. */
  private dispatching = false;

  private dedupKey(
    type: TransferType,
    sessionId: string,
    localPath: string,
    remotePath: string,
  ): string {
    return `${type}\0${sessionId}\0${localPath}\0${remotePath}`;
  }

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
    const key = this.dedupKey(type, sessionId, localPath, remotePath);
    const existingId = this.dedupIndex.get(key);
    if (existingId) {
      // A concurrent enqueue may have reserved this key and not yet pushed to
      // `queue` (still awaiting stat). Treat that as live so we return its id
      // and let the caller wire up to the same transfer, instead of racing
      // past the dedup check and creating a duplicate.
      if (this.reserved.has(existingId)) return existingId;
      const existing = this.active.get(existingId) ?? this.queue.find((t) => t.id === existingId);
      if (existing && !existing.controller.signal.aborted) return existing.id;
      // Stale entry (e.g. an aborted transfer that didn't clear the index).
      // Drop it so the new enqueue can take ownership of the key.
      this.dedupIndex.delete(key);
    }

    if (this.queue.length >= LIMITS.MAX_QUEUED_TRANSFERS) {
      throw new Error(
        `Transfer queue is full (${LIMITS.MAX_QUEUED_TRANSFERS} pending). Wait for transfers to complete or cancel some.`,
      );
    }

    // Reserve the dedup key synchronously, *before* the first await, so a
    // concurrent enqueue() with the same key short-circuits via dedupIndex
    // instead of also racing through stat() and pushing a duplicate.
    const transferId = uuidv4();
    this.dedupIndex.set(key, transferId);
    this.reserved.add(transferId);

    try {
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

      const fileName = basename(type === 'upload' ? localPath : remotePath);
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
    } catch (err) {
      // Roll back the dedup reservation so a future enqueue with the same key
      // isn't permanently blocked by a ghost entry.
      if (this.dedupIndex.get(key) === transferId) this.dedupIndex.delete(key);
      throw err;
    } finally {
      this.reserved.delete(transferId);
    }
  }

  private forgetDedup(t: QueuedTransfer): void {
    const key = this.dedupKey(t.type, t.sessionId, t.localPath, t.remotePath);
    // Only delete if it still points at this transfer — a later enqueue may
    // have already claimed the key after we marked this one aborted.
    if (this.dedupIndex.get(key) === t.id) this.dedupIndex.delete(key);
  }

  cancel(transferId: string): void {
    const queueIndex = this.queue.findIndex((t) => t.id === transferId);
    if (queueIndex !== -1) {
      const [transfer] = this.queue.splice(queueIndex, 1);
      transfer.controller.abort();
      this.forgetDedup(transfer);
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
        // Defense in depth — executeTransfer is async so a synchronous throw
        // already becomes a rejected promise, but if its catch handler (or a
        // future refactor) throws, we still need to ensure no rejection
        // escapes the dispatcher and lands as an unhandled rejection.
        try {
          this.executeTransfer(transfer)
            .catch((err) => {
              // Last-resort guard against a future change leaking a reject.
              try {
                this.active.delete(transfer.id);
                emitToRenderer(IPC.TRANSFER_ERROR, {
                  transferId: transfer.id,
                  error: err instanceof Error ? err.message : String(err),
                  errorClass: classifyTransferError(err),
                });
                this.processQueue();
              } catch (innerErr) {
                log.error('[TransferQueue] dispatcher error handler threw:', innerErr);
              }
            })
            // Final swallow: if the .catch() handler above somehow rejects
            // (synchronous throw inside it would resolve via the try block,
            // but defensive belt-and-braces) the promise still settles cleanly.
            .catch((finalErr) => {
              log.error('[TransferQueue] dispatcher catch chain leaked:', finalErr);
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
    } finally {
      this.active.delete(id);
      this.forgetDedup(transfer);
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
    this.dedupIndex.clear();
    this.reserved.clear();
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
