import { StringDecoder } from 'node:string_decoder';

/** Frame window for coalescing output into one IPC message. */
const FRAME_MS = 16;
/** Largest single emit; bigger frames are split so one message stays bounded. */
const MAX_EMIT_BYTES = 1024 * 1024;

interface SshBuffer {
  buffers: Buffer[];
  timer: NodeJS.Timeout | null;
  /**
   * One decoder for the life of the session, not one per frame. A multi-byte
   * UTF-8 character (emoji, CJK, box drawing) regularly straddles a 16 ms frame
   * boundary; decoding each frame on its own turned both halves into U+FFFD.
   * A persistent decoder carries the partial bytes into the next frame.
   */
  decoder: StringDecoder;
  onEmit: (data: string) => void;
}

/**
 * Manages per-session SSH terminal data buffering and throttling.
 * Batches incoming chunks into 16ms frames to prevent IPC flooding,
 * and ensures buffer maps and timers are properly pruned on disconnect.
 */
export class SshStreamBuffer {
  private buffers = new Map<string, SshBuffer>();

  /**
   * Queue incoming data chunk for a session. Flushes buffered data via `onEmit`
   * after a 16ms window.
   */
  queueData(sessionId: string, chunk: Buffer, onEmit: (data: string) => void): void {
    let sb = this.buffers.get(sessionId);
    if (!sb) {
      sb = { buffers: [], timer: null, decoder: new StringDecoder('utf8'), onEmit };
      this.buffers.set(sessionId, sb);
    }
    sb.onEmit = onEmit;
    sb.buffers.push(chunk);

    if (!sb.timer) {
      sb.timer = setTimeout(() => {
        const current = this.buffers.get(sessionId);
        if (current) this.flush(current);
      }, FRAME_MS);
    }
  }

  /** Decode and emit everything buffered, keeping any incomplete trailing character. */
  private flush(sb: SshBuffer): void {
    if (sb.timer) {
      clearTimeout(sb.timer);
      sb.timer = null;
    }
    const combined = sb.buffers.length === 1 ? sb.buffers[0]! : Buffer.concat(sb.buffers);
    sb.buffers = [];
    for (let offset = 0; offset < combined.length; offset += MAX_EMIT_BYTES) {
      const text = sb.decoder.write(combined.subarray(offset, offset + MAX_EMIT_BYTES));
      if (text.length > 0) sb.onEmit(text);
    }
  }

  /**
   * Deliver whatever is still buffered, then drop the session's state.
   * Call when a session disconnects, closes, or is disposed.
   *
   * Draining matters: up to a frame of output is always in flight, and simply
   * clearing the timer threw away the tail of the last command — often the
   * error printed just before the connection dropped. `flush: false` is for
   * callers that know the output has nowhere to go.
   */
  disposeSession(sessionId: string, options: { flush?: boolean } = {}): void {
    const sb = this.buffers.get(sessionId);
    if (!sb) return;
    this.buffers.delete(sessionId);
    if (options.flush === false) {
      if (sb.timer) clearTimeout(sb.timer);
      return;
    }
    this.flush(sb);
    // An incomplete character at the very end can never be completed now.
    const tail = sb.decoder.end();
    if (tail.length > 0) sb.onEmit(tail);
  }

  /**
   * Clear all session buffers. Call during application shutdown.
   */
  disposeAll(): void {
    for (const sessionId of Array.from(this.buffers.keys())) {
      this.disposeSession(sessionId, { flush: false });
    }
  }

  /**
   * Test-only helper to inspect active buffer map size.
   */
  get size(): number {
    return this.buffers.size;
  }
}

export const sshStreamBuffer = new SshStreamBuffer();
