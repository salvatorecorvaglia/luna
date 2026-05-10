import { describe, expect, it } from 'vitest';
import { formatPermissions, isSessionFatal } from '../sftp-helpers';
import { TimeoutError } from '../../../lib/with-timeout';
import { SshConnectionError } from '../../../lib/errors';

describe('formatPermissions', () => {
  it('renders 0o755 as rwxr-xr-x', () => {
    expect(formatPermissions(0o755)).toBe('rwxr-xr-x');
  });

  it('renders 0o644 as rw-r--r--', () => {
    expect(formatPermissions(0o644)).toBe('rw-r--r--');
  });

  it('renders 0o000 as ---------', () => {
    expect(formatPermissions(0o000)).toBe('---------');
  });

  it('renders 0o777 as rwxrwxrwx', () => {
    expect(formatPermissions(0o777)).toBe('rwxrwxrwx');
  });

  it('ignores high bits beyond the 9-bit permission set', () => {
    // 0o4755 has the setuid bit; the helper deliberately ignores it.
    expect(formatPermissions(0o4755)).toBe('rwxr-xr-x');
  });
});

describe('isSessionFatal', () => {
  it('returns true for TimeoutError', () => {
    expect(isSessionFatal(new TimeoutError('op', 1000))).toBe(true);
  });

  it('returns true for SshConnectionError', () => {
    expect(isSessionFatal(new SshConnectionError('disconnected'))).toBe(true);
  });

  it('returns true when err.code is in the fatal set', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isSessionFatal(err)).toBe(true);
  });

  it('returns true when message mentions a closed channel even without a code', () => {
    expect(isSessionFatal(new Error('Channel was closed'))).toBe(true);
  });

  it('returns true when message mentions "not connected"', () => {
    expect(isSessionFatal(new Error('Not connected'))).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isSessionFatal(new Error('No such file'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isSessionFatal('string')).toBe(false);
    expect(isSessionFatal(undefined)).toBe(false);
    expect(isSessionFatal(null)).toBe(false);
  });
});
