import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatEta,
  formatSize,
  formatSpeed,
} from '../../../src/renderer/src/lib/format';

describe('formatSize', () => {
  it('returns em-dash for non-positive byte counts', () => {
    expect(formatSize(0)).toBe('—');
    expect(formatSize(-5)).toBe('—');
  });

  it('formats bytes without a decimal', () => {
    expect(formatSize(12)).toBe('12 B');
  });

  it('formats kilobytes and megabytes with one decimal', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('scales through gigabytes and terabytes', () => {
    expect(formatSize(1024 ** 3)).toBe('1.0 GB');
    expect(formatSize(1024 ** 4)).toBe('1.0 TB');
  });
});

describe('formatDate', () => {
  it('includes the time for a timestamp in the current year', () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    // Same-year timestamps show time-of-day, which is what makes a directory
    // listing readable at a glance; older ones fall back to the year.
    expect(formatDate(anHourAgo)).toMatch(/\d{1,2}:\d{2}/);
  });

  it('includes the year for a timestamp from a previous year', () => {
    const ts = Math.floor(new Date(2020, 0, 15).getTime() / 1000);
    expect(formatDate(ts)).toContain('2020');
  });
});

describe('formatSpeed', () => {
  it('returns em-dash for zero or non-finite rates', () => {
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(Number.NaN)).toBe('—');
    expect(formatSpeed(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('appends /s to the formatted size', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s');
  });
});

describe('formatEta', () => {
  it('returns null when rate or remaining is non-positive', () => {
    expect(formatEta(0, 100)).toBeNull();
    expect(formatEta(100, 0)).toBeNull();
    expect(formatEta(100, Number.NaN)).toBeNull();
  });

  it('formats sub-minute durations in seconds', () => {
    expect(formatEta(50, 10)).toBe('5s');
  });

  it('formats sub-hour durations as minutes and seconds', () => {
    expect(formatEta(125, 1)).toBe('2m 5s');
  });

  it('formats multi-hour durations as hours and minutes', () => {
    expect(formatEta(3700, 1)).toBe('1h 1m');
  });
});
