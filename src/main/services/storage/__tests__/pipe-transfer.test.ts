import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { AbortError } from '../../../lib/errors';
import { runPipeTransfer } from '../pipe-transfer';
import type { StepCallback } from '../types';

vi.mock('../../../lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * This helper owns the abort/completion race for SFTP download, SFTP upload
 * and S3 download alike. The races it arbitrates are the ones that decide
 * whether a user's completed transfer survives a late cancel, so they get
 * tested here once instead of three times approximately.
 */

interface Harness {
  source: PassThrough;
  sink: Writable;
  written: Buffer[];
  controller: AbortController;
  discardPartial: Mock<() => Promise<void>>;
  onStep: Mock<StepCallback>;
  complete: { value: boolean };
}

/**
 * The sink is a plain Writable, not a PassThrough. Production sinks
 * (fs.WriteStream, ssh2's WriteStream) are Writables, and a Duplex only emits
 * 'close' once its *readable* half is also drained — which nothing here would
 * do, so a PassThrough sink would simply never signal completion.
 */
function harness(): Harness {
  const written: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      written.push(Buffer.from(chunk));
      cb();
    },
  });
  return {
    source: new PassThrough(),
    sink,
    written,
    controller: new AbortController(),
    discardPartial: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onStep: vi.fn<StepCallback>(),
    complete: { value: false },
  };
}

function run(h: Harness, overrides: Partial<Parameters<typeof runPipeTransfer>[0]> = {}) {
  return runPipeTransfer({
    source: h.source,
    sink: h.sink,
    signal: h.controller.signal,
    total: 100,
    onStep: h.onStep,
    isComplete: () => h.complete.value,
    discardPartial: h.discardPartial,
    abortCleanupDelayMs: 1,
    ...overrides,
  });
}

describe('runPipeTransfer — success path', () => {
  it('resolves when the sink closes and never discards', async () => {
    const h = harness();
    const promise = run(h);
    h.source.end('payload');
    await expect(promise).resolves.toBeUndefined();
    expect(Buffer.concat(h.written).toString()).toBe('payload');
    expect(h.discardPartial).not.toHaveBeenCalled();
  });

  it('reports cumulative progress with the declared total', async () => {
    const h = harness();
    const promise = run(h);
    h.source.write('abc');
    h.source.write('de');
    h.source.end();
    await promise;

    expect(h.onStep.mock.calls).toEqual([
      [3, 3, 100],
      [5, 2, 100],
    ]);
  });

  it('honours a "finish" completion event when asked', async () => {
    const h = harness();
    const promise = run(h, { completionEvent: 'finish' });
    h.source.end('x');
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('runPipeTransfer — abort handling', () => {
  it('rejects with AbortError and discards when aborted mid-transfer', async () => {
    const h = harness();
    const promise = run(h);
    h.source.write('partial');
    h.controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AbortError);
    expect(h.discardPartial).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const h = harness();
    h.controller.abort();
    await expect(run(h)).rejects.toBeInstanceOf(AbortError);
    expect(h.discardPartial).toHaveBeenCalledTimes(1);
  });

  // The race that costs a user a finished transfer: the abort lands after the
  // last byte is committed. Discarding here would delete a complete file.
  it('resolves without discarding when the abort loses the race to completion', async () => {
    const h = harness();
    const promise = run(h);
    h.complete.value = true;
    h.controller.abort();

    await expect(promise).resolves.toBeUndefined();
    expect(h.discardPartial).not.toHaveBeenCalled();
  });

  it('destroys both streams before discarding', async () => {
    const h = harness();
    const order: string[] = [];
    h.source.once('close', () => order.push('source-destroyed'));
    h.discardPartial.mockImplementation(async () => {
      order.push('discard');
    });

    const promise = run(h);
    h.controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AbortError);

    // Unlinking while a write is still in flight is how a "cancelled"
    // transfer ends up re-creating the file it just removed.
    expect(order).toEqual(['source-destroyed', 'discard']);
    expect(h.source.destroyed).toBe(true);
    expect(h.sink.destroyed).toBe(true);
  });

  it('does not act twice when abort fires after the transfer already settled', async () => {
    const h = harness();
    const promise = run(h);
    h.source.end('done');
    await promise;

    h.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.discardPartial).not.toHaveBeenCalled();
  });

  it('detaches its abort listener once settled', async () => {
    const h = harness();
    const removeSpy = vi.spyOn(h.controller.signal, 'removeEventListener');
    const promise = run(h);
    h.source.end('done');
    await promise;
    // A leaked listener on a long-lived controller keeps the closure — and
    // both streams — reachable for the rest of the session.
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('runPipeTransfer — error handling', () => {
  it('discards and rejects on a source error', async () => {
    const h = harness();
    const promise = run(h);
    const failure = new Error('remote read failed');
    h.source.destroy(failure);

    await expect(promise).rejects.toThrow('remote read failed');
    expect(h.discardPartial).toHaveBeenCalledTimes(1);
  });

  it('discards and rejects on a sink error', async () => {
    const h = harness();
    const promise = run(h);
    h.sink.destroy(new Error('ENOSPC'));

    await expect(promise).rejects.toThrow('ENOSPC');
    expect(h.discardPartial).toHaveBeenCalledTimes(1);
  });

  it('maps source errors when a mapper is supplied', async () => {
    // S3 relies on this to keep mid-stream failures classified rather than
    // surfacing a bare SDK error the transfer queue can't categorise.
    const h = harness();
    const promise = run(h, {
      mapSourceError: (err) => new Error(`s3-wrapped: ${err.message}`),
    });
    h.source.destroy(new Error('connection reset'));

    await expect(promise).rejects.toThrow('s3-wrapped: connection reset');
  });

  it('leaves sink errors unmapped so the local errno survives', async () => {
    const h = harness();
    const promise = run(h, {
      mapSourceError: () => new Error('should not be applied'),
    });
    h.sink.destroy(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    await expect(promise).rejects.toThrow('EACCES');
  });

  it('still rejects with the original error if discarding also fails', async () => {
    const h = harness();
    h.discardPartial.mockRejectedValue(new Error('unlink failed'));
    const promise = run(h);
    h.source.destroy(new Error('original failure'));

    await expect(promise).rejects.toThrow('original failure');
  });
});
