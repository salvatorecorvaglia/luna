import { ErrorCode, LunarError } from '@shared/errors';

/**
 * Token-bucket rate limiter per session for non-transfer storage ops
 * (list/stat/mkdir/delete/rename/read-file). A buggy or malicious renderer
 * spamming these handlers would otherwise fan out into N concurrent SFTP/S3
 * round-trips and either DoS the remote server or pile up timeouts.
 *
 * Bucket: 30 ops, refilled at 10 ops/sec — fast enough for batch UI flows
 * (e.g. stat'ing 20 files after a directory list) but well under what an
 * automated abuser would need to overwhelm a server.
 */
const RATE_BUCKET_CAP = 30;
const RATE_REFILL_PER_SEC = 10;
/**
 * Hard cap on the number of session buckets kept in memory. `releaseStorageBucket`
 * frees buckets on disconnect, but a renderer that crashes or a connect path
 * that errors out before wiring the disconnect handler can strand a bucket
 * forever. The cap converts the worst case from "unbounded growth" into
 * "evict the oldest" — Map preserves insertion order, so the first inserted
 * (least-recently-created) bucket is the natural eviction target.
 */
const MAX_TRACKED_SESSIONS = 1024;

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function takeStorageToken(sessionId: string): void {
  const now = Date.now();
  let bucket = rateBuckets.get(sessionId);
  if (!bucket) {
    bucket = { tokens: RATE_BUCKET_CAP, lastRefill: now };
    rateBuckets.set(sessionId, bucket);
    while (rateBuckets.size > MAX_TRACKED_SESSIONS) {
      const oldest = rateBuckets.keys().next();
      if (oldest.done) break;
      // Don't evict the bucket we just inserted, even in the degenerate case
      // where the cap is 1 — that would break the very call we're servicing.
      if (oldest.value === sessionId) break;
      rateBuckets.delete(oldest.value);
    }
  }
  // Clock skew guard: a wall-clock jump backwards makes elapsedSec negative,
  // which leaves `lastRefill` pinned in the future and refills frozen until
  // real time catches up. Reset the marker so the bucket starts refilling
  // from "now" instead of stalling the session.
  if (now < bucket.lastRefill) {
    bucket.lastRefill = now;
  }
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(RATE_BUCKET_CAP, bucket.tokens + elapsedSec * RATE_REFILL_PER_SEC);
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) {
    throw new LunarError(
      `Storage rate limit exceeded for session ${sessionId}. Slow down or wait a moment.`,
      ErrorCode.FORBIDDEN,
    );
  }
  bucket.tokens -= 1;
}

/** Release the bucket for a session — call on disconnect to free memory. */
export function releaseStorageBucket(sessionId: string): void {
  rateBuckets.delete(sessionId);
}

/** Test-only: reset all rate buckets between tests. */
export function __resetStorageRateLimiter(): void {
  rateBuckets.clear();
}
