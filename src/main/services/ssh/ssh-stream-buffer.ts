import { StringDecoder } from 'node:string_decoder';

interface SshBuffer {
  buffers: Buffer[];
  timer: NodeJS.Timeout | null;
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
      sb = { buffers: [], timer: null };
      this.buffers.set(sessionId, sb);
    }
    sb.buffers.push(chunk);

    if (!sb.timer) {
      sb.timer = setTimeout(() => {
        const currentSb = this.buffers.get(sessionId);
        if (!currentSb) return;
        const combinedBuf = Buffer.concat(currentSb.buffers);
        currentSb.buffers = [];
        currentSb.timer = null;

        if (combinedBuf.length > 0) {
          const limitBytes = 1024 * 1024; // 1MB chunk cap
          if (combinedBuf.length <= limitBytes) {
            onEmit(combinedBuf.toString('utf-8'));
          } else {
            const decoder = new StringDecoder('utf8');
            for (let offset = 0; offset < combinedBuf.length; offset += limitBytes) {
              const slice = combinedBuf.subarray(offset, offset + limitBytes);
              const chunkStr = decoder.write(slice);
              if (chunkStr.length > 0) {
                onEmit(chunkStr);
              }
            }
            const tail = decoder.end();
            if (tail.length > 0) {
              onEmit(tail);
            }
          }
        }
      }, 16);
    }
  }

  /**
   * Clean up buffer memory and cancel active timers for a session.
   * Call when a session disconnects, closes, or is disposed.
   */
  disposeSession(sessionId: string): void {
    const sb = this.buffers.get(sessionId);
    if (sb) {
      if (sb.timer) {
        clearTimeout(sb.timer);
        sb.timer = null;
      }
      sb.buffers = [];
      this.buffers.delete(sessionId);
    }
  }

  /**
   * Clear all session buffers. Call during application shutdown.
   */
  disposeAll(): void {
    for (const sessionId of Array.from(this.buffers.keys())) {
      this.disposeSession(sessionId);
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
