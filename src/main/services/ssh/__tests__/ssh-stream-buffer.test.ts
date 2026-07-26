import { describe, expect, it, vi } from 'vitest';
import { SshStreamBuffer } from '../ssh-stream-buffer';

describe('SshStreamBuffer', () => {
  it('batches chunks and flushes via onEmit callback after throttle window', async () => {
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();

    buffer.queueData('sess-1', Buffer.from('hello '), emitFn);
    buffer.queueData('sess-1', Buffer.from('world'), emitFn);

    expect(emitFn).not.toHaveBeenCalled();

    // Wait for the 16ms throttle window to fire
    await new Promise((r) => setTimeout(r, 30));

    expect(emitFn).toHaveBeenCalledOnce();
    expect(emitFn).toHaveBeenCalledWith('hello world');
    expect(buffer.size).toBe(1);

    buffer.disposeSession('sess-1');
    expect(buffer.size).toBe(0);
  });

  it('cancels scheduled timers and clears buffers on disposeSession', async () => {
    const buffer = new SshStreamBuffer();
    const emitFn = vi.fn();

    buffer.queueData('sess-2', Buffer.from('test'), emitFn);
    expect(buffer.size).toBe(1);

    buffer.disposeSession('sess-2');
    expect(buffer.size).toBe(0);

    await new Promise((r) => setTimeout(r, 30));
    expect(emitFn).not.toHaveBeenCalled();
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
