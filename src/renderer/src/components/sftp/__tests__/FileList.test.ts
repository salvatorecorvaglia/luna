import { describe, expect, it } from 'vitest';
import { formatDate, formatSize } from '@/lib/format';

describe('formatSize', () => {
  it('returns dash for zero bytes', () => {
    expect(formatSize(0)).toBe('—');
  });

  it('returns dash for negative bytes', () => {
    expect(formatSize(-100)).toBe('—');
  });

  it('formats bytes', () => {
    expect(formatSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('formats terabytes', () => {
    expect(formatSize(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
  });

  it('formats fractional sizes', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
  });
});

describe('formatDate', () => {
  it('formats a timestamp from this year with time', () => {
    const ts = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const result = formatDate(ts);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(5);
  });

  it('formats a timestamp from a different year without time', () => {
    const ts = Math.floor(new Date(2020, 0, 15).getTime() / 1000);
    const result = formatDate(ts);
    expect(result).toContain('2020');
  });
});
