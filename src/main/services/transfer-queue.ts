import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import { IPC, LIMITS } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import type { TransferType } from '@shared/types/transfer';
import { classifyTransferError } from '../lib/error-map';
import { AbortError } from '../lib/errors';
import log from '../lib/logger';
import { emitToRenderer } from './emit';
import { storageRegistry } from './storage/registry';
import { executeTransfer, type TransferExecution } from './storage/transfer-execution';

interface QueuedTransfer extends TransferExecution {
  destinationKey: string;
  fileName: string;
}

interface ReservedTransfer {
  done: Promise<void>;
  id: string;
  key: string;
  /** Needed so cancelBySession can reach transfers still inside the stat() window. */
  sessionId: string;
  controller: AbortController;
}

export class TransferQueue {
  private queue: QueuedTransfer[] = [];
  private queuedMap = new Map<string, QueuedTransfer>();
  private active = new Map<string, QueuedTransfer>();
  /** Bounded replay protection and operation/destination lookup indexes. */
  private usedIds = new Set<string>();
  private dedupIndex = new Map<string, string>();
  /** Destination claims survive cancellation until the provider finishes cleanup. */
  private downloadDestinations = new Map<string, string>();
  private uploadDestinations = new Map<string, string>();
  private executions = new Set<Promise<void>>();
  /** Reservations count toward capacity and remain cancellable during metadata reads. */
  private reserved = new Map<string, ReservedTransfer>();
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

  private uploadDestination(sessionId: string, path: string): string {
    const destination = storageRegistry.kindOf(sessionId) === 'sftp' ? posix.normalize(path) : path;
    return `${sessionId}\0${destination}`;
  }

  setMaxConcurrent(max: number): void {
    const n = Number.isFinite(max) ? Math.round(max) : 3;
    this.maxConcurrent = Math.max(1, Math.min(LIMITS.MAX_CONCURRENT_TRANSFERS, n));
    this.processQueue();
  }

  async enqueue(
    type: TransferType,
    sessionId: string,
    localPath: string,
    remotePath: string,
    requestedId?: string,
  ): Promise<string> {
    if (requestedId && (this.usedIds.has(requestedId) || this.isLive(requestedId))) {
      throw new LunaError('Transfer id already used', ErrorCode.VALIDATION_ERROR);
    }
    const key = this.dedupKey(type, sessionId, localPath, remotePath);
    const existingId = this.dedupIndex.get(key);
    if (existingId) {
      if (requestedId && this.isLive(existingId)) {
        throw new LunaError('Transfer already queued', ErrorCode.VALIDATION_ERROR);
      }
      // A concurrent enqueue may have reserved this key and not yet pushed to
      // `queue` (still awaiting stat). Treat that as live so we return its id
      // and let the caller wire up to the same transfer, instead of racing
      // past the dedup check and creating a duplicate.
      const reserved = this.reserved.get(existingId);
      if (reserved && !reserved.controller.signal.aborted) return existingId;
      const existing = this.active.get(existingId) ?? this.queuedMap.get(existingId);
      if (existing && !existing.controller.signal.aborted) return existing.id;
      // Stale entry (e.g. an aborted transfer that didn't clear the index).
      // Drop it so the new enqueue can take ownership of the key.
      this.dedupIndex.delete(key);
    }

    const destinations = type === 'download' ? this.downloadDestinations : this.uploadDestinations;
    const destinationKey =
      type === 'download' ? localPath : this.uploadDestination(sessionId, remotePath);
    const clashId = destinations.get(destinationKey);
    if (clashId && this.isLive(clashId)) {
      throw new LunaError(
        `Another ${type} is already writing to ${type === 'download' ? localPath : remotePath}. Wait for cleanup to finish.`,
        ErrorCode.VALIDATION_ERROR,
        { reason: 'destination-busy' },
      );
    }
    if (clashId) destinations.delete(destinationKey);

    // Reserve capacity before metadata I/O so concurrent enqueues cannot overfill.
    const pending = this.queue.length + this.reserved.size;
    if (pending >= LIMITS.MAX_QUEUED_TRANSFERS) {
      throw new LunaError(
        `Transfer queue is full (${LIMITS.MAX_QUEUED_TRANSFERS} pending). Wait for transfers to complete or cancel some.`,
        ErrorCode.VALIDATION_ERROR,
        { limit: LIMITS.MAX_QUEUED_TRANSFERS, reason: 'queue-full' },
      );
    }

    // Claims and cancellation exist before the first await.
    const transferId = requestedId ?? randomUUID();
    this.usedIds.add(transferId);
    // Bound replay protection; live IDs are always checked independently.
    if (this.usedIds.size > 10_000) this.usedIds.delete(this.usedIds.values().next().value!);
    const controller = new AbortController();
    this.dedupIndex.set(key, transferId);
    let finishReservation!: () => void;
    const done = new Promise<void>((resolve) => {
      finishReservation = resolve;
    });
    this.reserved.set(transferId, { id: transferId, key, sessionId, controller, done });
    destinations.set(destinationKey, transferId);

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

      // Setup rejection is observable even before the renderer receives its enqueue response.
      if (controller.signal.aborted) {
        throw new AbortError('Transfer cancelled before it started');
      }

      const fileName = basename(type === 'upload' ? localPath : remotePath);
      const transfer: QueuedTransfer = {
        id: transferId,
        type,
        sessionId,
        localPath,
        remotePath,
        destinationKey,
        fileName,
        size,
        controller,
        lastEmitTime: Date.now(),
        lastTransferred: 0,
      };

      this.queue.push(transfer);
      this.queuedMap.set(transferId, transfer);

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
      if (destinations.get(destinationKey) === transferId) destinations.delete(destinationKey);
      throw err;
    } finally {
      finishReservation();
      this.reserved.delete(transferId);
    }
  }

  /** Aborted transfers still own resources until teardown settles. */
  private isLive(transferId: string): boolean {
    const reserved = this.reserved.get(transferId);
    if (reserved) return true;
    const transfer = this.active.get(transferId) ?? this.queuedMap.get(transferId);
    return Boolean(transfer);
  }

  /** Release a download's claim on its destination path. */
  private forgetDestination(transferId: string, localPath: string): void {
    if (this.downloadDestinations.get(localPath) === transferId) {
      this.downloadDestinations.delete(localPath);
    }
  }

  private forgetDedup(t: QueuedTransfer): void {
    const key = this.dedupKey(t.type, t.sessionId, t.localPath, t.remotePath);
    // Only delete if it still points at this transfer — a later enqueue may
    // have already claimed the key after we marked this one aborted.
    if (this.dedupIndex.get(key) === t.id) this.dedupIndex.delete(key);
    if (t.type === 'download') this.forgetDestination(t.id, t.localPath);
    else {
      const destination = t.destinationKey;
      if (this.uploadDestinations.get(destination) === t.id)
        this.uploadDestinations.delete(destination);
    }
  }

  cancel(transferId: string): void {
    const transfer = this.queuedMap.get(transferId);
    if (transfer) {
      const queueIndex = this.queue.indexOf(transfer);
      if (queueIndex !== -1) {
        this.queue.splice(queueIndex, 1);
      }
      this.queuedMap.delete(transferId);
      transfer.controller.abort();
      this.forgetDedup(transfer);
      emitToRenderer(IPC.TRANSFER_CANCELLED, { transferId });
      return;
    }

    const active = this.active.get(transferId);
    if (active) {
      active.controller.abort();
      return;
    }

    // A preflight reservation has no queued/active entry yet.
    const reserved = this.reserved.get(transferId);
    if (reserved) {
      reserved.controller.abort();
      if (this.dedupIndex.get(reserved.key) === transferId) {
        this.dedupIndex.delete(reserved.key);
      }
    }
  }

  private processQueue(): void {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
        const transfer = this.queue.shift()!;
        this.queuedMap.delete(transfer.id);
        this.active.set(transfer.id, transfer);
        // Claims are released only after provider cleanup and its terminal event.
        const execution = this.executeTransfer(transfer).catch((err) => {
          this.active.delete(transfer.id);
          this.forgetDedup(transfer);
          emitToRenderer(IPC.TRANSFER_ERROR, {
            transferId: transfer.id,
            error: err instanceof Error ? err.message : String(err),
            errorClass: classifyTransferError(err),
          });
          log.error('[TransferQueue] dispatcher fallback handled rejection:', err);
          this.processQueue();
        });
        this.executions.add(execution);
        void execution.finally(() => this.executions.delete(execution));
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async executeTransfer(transfer: QueuedTransfer): Promise<void> {
    try {
      await executeTransfer(transfer);
    } finally {
      this.active.delete(transfer.id);
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
    // Keep active and reserved claims until their async work has unwound.
    for (const transfer of [...this.queue]) this.cancel(transfer.id);
    for (const transfer of this.active.values()) this.cancel(transfer.id);
    for (const reserved of this.reserved.values()) this.cancel(reserved.id);
  }

  async waitForIdle(): Promise<void> {
    while (this.executions.size > 0 || this.reserved.size > 0) {
      await Promise.all([...this.executions, ...Array.from(this.reserved.values(), (r) => r.done)]);
    }
  }

  cancelBySession(sessionId: string): void {
    const toCancel: string[] = [];
    for (const t of this.queue) {
      if (t.sessionId === sessionId) toCancel.push(t.id);
    }
    for (const t of this.active.values()) {
      if (t.sessionId === sessionId) toCancel.push(t.id);
    }
    // Include requests still waiting for metadata.
    for (const r of this.reserved.values()) {
      if (r.sessionId === sessionId) toCancel.push(r.id);
    }
    for (const id of toCancel) this.cancel(id);
  }
}

export const transferQueue = new TransferQueue();
