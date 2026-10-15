import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SshStreamBuffer } from '../../../../src/main/services/ssh/ssh-stream-buffer';

describe('SshStreamBuffer', () => {
  // Fake timers: the flush is a 16 ms setTimeout, and waiting on it in real
  // time (30 ms) flaked on loaded CI runners.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches chunks and flushes via onEmit callback after throttle window', async () => {
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();

    buffer.queueData('sess-1', Buffer.from('hello '), emitFn);
    buffer.queueData('sess-1', Buffer.from('world'), emitFn);

    expect(emitFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(emitFn).toHaveBeenCalledOnce();
    expect(emitFn).toHaveBeenCalledWith('hello world');
    expect(buffer.size).toBe(1);

    buffer.disposeSession('sess-1');
    expect(buffer.size).toBe(0);
  });

  it('delivers buffered output on disposeSession instead of dropping it', () => {
    // Regression: dispose cleared the timer and discarded up to a frame of
    // output — usually the error printed just before the connection dropped.
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();

    buffer.queueData('sess-2', Buffer.from('last words'), emitFn);
    buffer.disposeSession('sess-2');

    expect(emitFn).toHaveBeenCalledWith('last words');
    expect(buffer.size).toBe(0);
    vi.advanceTimersByTime(100);
    expect(emitFn).toHaveBeenCalledTimes(1);
  });

  it('can discard instead when asked', () => {
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();
    buffer.queueData('sess-3', Buffer.from('x'), emitFn);
    buffer.disposeSession('sess-3', { flush: false });
    vi.advanceTimersByTime(100);
    expect(emitFn).not.toHaveBeenCalled();
  });

  it('keeps a multi-byte character intact across a frame boundary', () => {
    // Regression: each 16 ms frame was decoded on its own, so an emoji split
    // between two frames rendered as two U+FFFD replacement characters.
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();
    const smile = Buffer.from('a😀b', 'utf-8'); // 'a' + 4 bytes + 'b'

    buffer.queueData('sess-4', smile.subarray(0, 3), emitFn); // 'a' + 2 of 4 bytes
    vi.advanceTimersByTime(16);
    buffer.queueData('sess-4', smile.subarray(3), emitFn);
    vi.advanceTimersByTime(16);

    const text = emitFn.mock.calls.map((c) => c[0]).join('');
    expect(text).toBe('a😀b');
    expect(text).not.toContain('\uFFFD');
  });

  it('clears all session buffers on disposeAll', () => {
    const buffer = new SshStreamBuffer();
    buffer.queueData('sess-a', Buffer.from('a'), vi.fn());
    buffer.queueData('sess-b', Buffer.from('b'), vi.fn());

    expect(buffer.size).toBe(2);
    buffer.disposeAll();
    expect(buffer.size).toBe(0);
  });
});
