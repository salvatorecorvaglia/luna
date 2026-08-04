import { ErrorCode } from '@shared/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidingWindowLimiter } from '../sliding-window-limiter';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SlidingWindowLimiter', () => {
  it('allows exactly maxPerWindow calls', () => {
    const limiter = new SlidingWindowLimiter(3, 60_000, 'Test');
    expect(() => {
      limiter.check();
      limiter.check();
      limiter.check();
    }).not.toThrow();
    expect(() => limiter.check()).toThrow(/rate limit exceeded/);
  });

  it('reports FORBIDDEN with the limit in the message', () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, 'Credential retrieval');
    limiter.check();
    try {
      limiter.check();
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.FORBIDDEN);
      expect((err as Error).message).toContain('Credential retrieval');
      expect((err as Error).message).toContain('max 1 per 60s');
    }
  });

  it('slides: a call falling out of the window frees a slot', () => {
    const limiter = new SlidingWindowLimiter(2, 1_000, 'Test');
    limiter.check();
    vi.advanceTimersByTime(600);
    limiter.check();
    expect(() => limiter.check()).toThrow();

    // The first call ages out at t=1000; the second is still inside the window.
    vi.advanceTimersByTime(500); // t = 1100
    expect(() => limiter.check()).not.toThrow();
    expect(() => limiter.check()).toThrow();
  });

  it('does not let a burst at the window boundary through', () => {
    // The fixed-window variant this replaced allowed 2×max across a boundary.
    const limiter = new SlidingWindowLimiter(5, 1_000, 'Test');
    for (let i = 0; i < 5; i++) limiter.check();
    vi.advanceTimersByTime(999);
    expect(() => limiter.check()).toThrow();
  });

  it('recovers fully once the whole window has elapsed', () => {
    const limiter = new SlidingWindowLimiter(2, 1_000, 'Test');
    limiter.check();
    limiter.check();
    vi.advanceTimersByTime(1_001);
    expect(() => {
      limiter.check();
      limiter.check();
    }).not.toThrow();
  });

  it('reset() clears recorded calls', () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, 'Test');
    limiter.check();
    expect(() => limiter.check()).toThrow();
    limiter.reset();
    expect(() => limiter.check()).not.toThrow();
  });

  it('stays bounded in memory across many windows', () => {
    // Ring buffer: the backing array is allocated once at maxPerWindow and
    // never grows, no matter how many calls pass through.
    const limiter = new SlidingWindowLimiter(4, 100, 'Test');
    for (let i = 0; i < 1000; i++) {
      vi.advanceTimersByTime(50);
      try {
        limiter.check();
      } catch {
        // expected once the window fills
      }
    }
    const backing = (limiter as unknown as { timestamps: number[] }).timestamps;
    expect(backing).toHaveLength(4);
  });
});
