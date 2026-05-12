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
