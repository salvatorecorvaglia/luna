import { ErrorCode, LunaError } from '@shared/errors';

/**
 * Fixed-capacity sliding-window rate limiter.
 *
 * Extracted from `credentials.ipc.ts`, which had one hand-rolled instance
 * guarding credential retrieval while the neighbouring — and strictly more
 * dangerous — `credential:resolve-external` handler had none at all. Making
 * this a reusable primitive means "add a limiter" is a one-line change rather
 * than 20 lines of ring-buffer bookkeeping each caller might get subtly wrong.
 *
 * Implementation is a ring buffer over the window: O(1) per check, no
 * per-call array allocation. `head`/`tail` are monotonically increasing
 * counters, so `size === tail - head`.
 */
export class SlidingWindowLimiter {
  private readonly timestamps: number[];
  private head = 0;
  private tail = 0;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly label: string,
  ) {
    this.timestamps = new Array<number>(maxPerWindow);
  }

  /** Record one call, throwing `FORBIDDEN` if the window is already full. */
  check(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    // Non-null: for any head < tail, slot (head % maxPerWindow) was written
    // the last time tail was at that same modular position, since tail only
    // ever advances by one and every index is written before head can reach it.
    while (this.head < this.tail && this.timestamps[this.head % this.maxPerWindow]! < cutoff) {
      this.head++;
    }
    if (this.tail - this.head >= this.maxPerWindow) {
      throw new LunaError(
        `${this.label} rate limit exceeded (max ${this.maxPerWindow} per ${Math.round(
          this.windowMs / 1000,
        )}s)`,
        ErrorCode.FORBIDDEN,
        { reason: 'rate-limited' },
      );
    }
    this.timestamps[this.tail % this.maxPerWindow] = now;
    this.tail++;
  }

  /** Test-only: forget all recorded calls. */
  reset(): void {
    this.head = 0;
    this.tail = 0;
  }
}
