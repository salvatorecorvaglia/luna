import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStorageRateLimiter,
  releaseStorageBucket,
  takeStorageToken,
} from '../../../src/main/lib/rate-limiter';

beforeEach(() => {
  __resetStorageRateLimiter();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('takeStorageToken', () => {
  it('allows up to the bucket cap without throwing', () => {
    // Bucket cap is 30 — burst that many in a tight loop must succeed.
    for (let i = 0; i < 30; i++) takeStorageToken('s');
  });

  it('throws once the bucket is empty', () => {
    for (let i = 0; i < 30; i++) takeStorageToken('s');
    expect(() => takeStorageToken('s')).toThrow(/rate limit exceeded/);
  });

  it('refills at the configured rate', () => {
    for (let i = 0; i < 30; i++) takeStorageToken('s');
    expect(() => takeStorageToken('s')).toThrow();
    // 10 tokens/sec → ~100ms recovers one token.
    vi.advanceTimersByTime(150);
    expect(() => takeStorageToken('s')).not.toThrow();
  });

  it('tracks buckets independently per session', () => {
    for (let i = 0; i < 30; i++) takeStorageToken('a');
    expect(() => takeStorageToken('a')).toThrow();
    // Session 'b' has its own bucket and is unaffected.
    expect(() => takeStorageToken('b')).not.toThrow();
  });

  it('releases a bucket on disconnect', () => {
    for (let i = 0; i < 30; i++) takeStorageToken('s');
    releaseStorageBucket('s');
    // Fresh bucket: full cap available again.
    for (let i = 0; i < 30; i++) takeStorageToken('s');
  });

  it('does not freeze refills after a backward wall-clock jump', () => {
    takeStorageToken('s');
    // Simulate the system clock jumping 1h into the past. Without the skew
    // guard, lastRefill stays in the future and the bucket never refills.
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    // Consume the rest of the bucket — should still work because cap isn't
    // exceeded yet.
    for (let i = 0; i < 29; i++) takeStorageToken('s');
    expect(() => takeStorageToken('s')).toThrow();
    // Move time forward enough to refill at least one token.
    vi.advanceTimersByTime(200);
    expect(() => takeStorageToken('s')).not.toThrow();
  });

  it('evicts the oldest bucket when the tracked-session cap is exceeded', () => {
    // The hard cap is 1024. Creating 1024 + 1 distinct sessions must drop
    // the first-inserted one rather than grow the map without bound.
    for (let i = 0; i < 1024; i++) takeStorageToken(`s${i}`);
    // Drain `s0` so a refill after eviction would notice if the entry
    // somehow stayed.
    for (let i = 0; i < 29; i++) takeStorageToken('s0');
    expect(() => takeStorageToken('s0')).toThrow();
    // Inserting a 1025th session evicts the oldest existing entry. The
    // oldest at this point is the first-inserted one that's still earliest
    // in Map insertion order — after the re-touches above, that's still
    // 's0' because Map.set on an existing key doesn't reorder.
    takeStorageToken('s-new');
    // s0's bucket is gone; a fresh take re-creates it at full cap.
    for (let i = 0; i < 30; i++) takeStorageToken('s0');
  });
});
