import type { Readable, Writable } from 'node:stream';
import { AbortError } from '../../lib/errors';
import log from '../../lib/logger';
import type { StepCallback } from './types';

/**
 * Shared skeleton for a stream-piped, abortable transfer.
 *
 * SFTP download, SFTP upload and S3 download each hand-rolled the same
 * ~40-line body: a settle-once guard, an abort listener that has to be
 * removed on every exit path, a "did the abort lose the race against
 * completion" check, progress accounting, and error wiring on both streams.
 * Three copies meant three chances to get the ordering subtly wrong — and
 * they had already drifted (one resolved on `finish`, one on `close`; one
 * removed the abort listener before cleanup, one after).
 *
 * The genuinely provider-specific parts are the two callbacks: what counts as
 * "already complete", and how to discard a partial artifact.
 *
 * Note that S3 *upload* is not expressed here — it goes through the AWS SDK's
 * `Upload` helper rather than a pipe, so it has no source/sink pair to wire.
 */

export interface PipeTransferOptions {
  /** ssh2 ReadStream, fs.ReadStream and the S3 SDK body all extend Readable. */
  source: Readable;
  /** ssh2 WriteStream and fs.WriteStream both extend Writable. */
  sink: Writable;
  signal: AbortSignal;
  /** Expected byte count, or 0 when the size could not be determined up front. */
  total: number;
  onStep: StepCallback;
  /**
   * True once the payload is fully committed at the destination. An abort
   * that lands after this must resolve rather than destroy a finished
   * artifact — the race is real and costs the user a completed transfer.
   */
  isComplete(): boolean;
  /**
   * Remove the partial artifact. Called after both streams are destroyed and
   * the settle delay has elapsed. Implementations own their own "actually, it
   * did finish" guard, because the check differs by provider (on-disk size for
   * a download, a close flag for an upload).
   */
  discardPartial(): Promise<void>;
  /**
   * Grace period after `destroy()` before discarding, so an in-flight write
   * doesn't race the unlink. See SFTP_ABORT_CLEANUP_DELAY_MS.
   */
  abortCleanupDelayMs: number;
  /**
   * Sink event that signals completion. Defaults to 'close'.
   *
   * 'close' rather than 'finish' matters for fs write streams: 'finish' only
   * means the writable side ended, while the file descriptor may still be
   * open, so a caller that immediately stat()s the file can see a short read.
   */
  completionEvent?: 'close' | 'finish';
  /**
   * Translate a source-stream error before it is rejected. S3 needs this to
   * keep its errors classified (`wrapS3Error`); SFTP passes them through.
   * Sink errors are never mapped — those are local filesystem failures and
   * should surface with their original `code`.
   */
  mapSourceError?: (err: Error) => Error;
}

export function runPipeTransfer(options: PipeTransferOptions): Promise<void> {
  const {
    source,
    sink,
    signal,
    total,
    onStep,
    isComplete,
    discardPartial,
    abortCleanupDelayMs,
    completionEvent = 'close',
    mapSourceError = (err) => err,
  } = options;

  const cleanup = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      source.destroy();
      sink.destroy();
      setTimeout(resolve, abortCleanupDelayMs);
    });
    await discardPartial();
  };

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let transferred = 0;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const failWith = (err: Error): void => {
      settle(() => {
        // `.finally()` re-throws whatever cleanup rejected with, and nothing
        // is chained after this — so a failing discard surfaced as an
        // unhandled rejection, which this process answers with exit(1).
        // Swallow it: the caller needs the *transfer's* error, and a failed
        // cleanup is a log line, not a reason to lose the real cause.
        void cleanup()
          .catch((cleanupErr) => {
            log.warn('[transfer] cleanup after failure did not complete:', cleanupErr);
          })
          .finally(() => reject(err));
      });
    };

    function onAbort(): void {
      if (isComplete()) {
        settle(() => resolve());
        return;
      }
      failWith(new AbortError('Transfer cancelled'));
    }

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    source.on('data', (chunk: Buffer | string) => {
      transferred += chunk.length;
      onStep(transferred, chunk.length, total);
    });

    source.on('error', (err: Error) => failWith(mapSourceError(err)));
    sink.on('error', (err: Error) => failWith(err));
    sink.on(completionEvent, () => settle(() => resolve()));

    source.pipe(sink);
  });
}
