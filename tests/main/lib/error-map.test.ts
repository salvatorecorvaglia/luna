import { describe, expect, it } from 'vitest';
import { classifyTransferError, describeSshError } from '../../../src/main/lib/error-map';

function withCode(message: string, code: string): Error {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('describeSshError', () => {
  it('returns String() for non-Error inputs so a thrown string still produces a message', () => {
    expect(describeSshError('boom')).toBe('boom');
    expect(describeSshError(42)).toBe('42');
    expect(describeSshError(undefined)).toBe('undefined');
  });

  it('maps ENOTFOUND and getaddrinfo to the host-not-found hint', () => {
    expect(describeSshError(withCode('getaddrinfo ENOTFOUND host', 'ENOTFOUND'))).toMatch(
      /host not found/i,
    );
    expect(describeSshError(new Error('getaddrinfo failed'))).toMatch(/host not found/i);
  });

  it('maps ECONNREFUSED to the refused hint', () => {
    expect(describeSshError(withCode('connect ECONNREFUSED', 'ECONNREFUSED'))).toMatch(
      /connection refused/i,
    );
  });

  it('maps ETIMEDOUT / "timed out" to the timeout hint', () => {
    expect(describeSshError(withCode('timed out', 'ETIMEDOUT'))).toMatch(/timed out/i);
    expect(describeSshError(new Error('Connection timed out'))).toMatch(/timed out/i);
  });

  it('maps EHOSTUNREACH to the unreachable hint', () => {
    expect(describeSshError(withCode('host unreachable', 'EHOSTUNREACH'))).toMatch(
      /host is unreachable/i,
    );
  });

  it('maps the ssh2 auth-methods phrase to the auth-failed hint', () => {
    expect(describeSshError(new Error('All configured authentication methods failed'))).toMatch(
      /authentication failed/i,
    );
  });

  it('uses the handshake-timeout hint when the message says "timeout" (not "timed out")', () => {
    // The "timed out" branch is checked before the handshake branch, so a
    // message containing "timed out" short-circuits to the generic timeout
    // hint. The handshake branch fires for "timeout" (the other half of the
    // handshake regex).
    expect(describeSshError(new Error('Handshake timeout reached'))).toMatch(/handshake/i);
  });

  it('maps host-key errors', () => {
    expect(describeSshError(new Error('Host key mismatch'))).toMatch(/host key/i);
  });

  it('falls back to the raw message for anything else', () => {
    expect(describeSshError(new Error('some other failure'))).toBe('some other failure');
  });
});

describe('classifyTransferError', () => {
  it('returns "unknown" for non-Error inputs', () => {
    expect(classifyTransferError('nope')).toBe('unknown');
    expect(classifyTransferError(null)).toBe('unknown');
  });

  it('classifies cancel/abort messages as cancelled', () => {
    expect(classifyTransferError(new Error('Transfer cancelled by user'))).toBe('cancelled');
    expect(classifyTransferError(new Error('aborted'))).toBe('cancelled');
  });

  it('classifies timeout messages and ETIMEDOUT as timeout', () => {
    expect(classifyTransferError(new Error('operation timeout'))).toBe('timeout');
    expect(classifyTransferError(withCode('x', 'ETIMEDOUT'))).toBe('timeout');
  });

  it('classifies permission denied / EACCES / EPERM as permission', () => {
    expect(classifyTransferError(withCode('x', 'EACCES'))).toBe('permission');
    expect(classifyTransferError(withCode('x', 'EPERM'))).toBe('permission');
    expect(classifyTransferError(new Error('Permission denied'))).toBe('permission');
    expect(classifyTransferError(new Error('access denied'))).toBe('permission');
  });

  it('classifies ENOSPC / "no space" as disk-full', () => {
    expect(classifyTransferError(withCode('x', 'ENOSPC'))).toBe('disk-full');
    expect(classifyTransferError(new Error('No space left on device'))).toBe('disk-full');
  });

  it('classifies channel/connection/closed and reset/pipe codes as connection', () => {
    expect(classifyTransferError(new Error('Channel closed'))).toBe('connection');
    expect(classifyTransferError(new Error('connection lost'))).toBe('connection');
    expect(classifyTransferError(withCode('x', 'ECONNRESET'))).toBe('connection');
    expect(classifyTransferError(withCode('x', 'EPIPE'))).toBe('connection');
  });

  it('prioritises cancelled over connection when both keywords are present', () => {
    // "cancelled" check runs before "closed"/"connection" so a cancel that
    // also mentions a closed channel still classifies as cancelled.
    expect(classifyTransferError(new Error('cancelled — channel closed'))).toBe('cancelled');
  });

  it('falls back to "unknown" for unrecognised errors', () => {
    expect(classifyTransferError(new Error('weird and unrecognised'))).toBe('unknown');
  });
});
