import { describe, expect, it } from 'vitest';
import { AbortError, S3StorageError } from '../../../lib/errors';
import { objectToEntry, prefixToEntry, wrapS3Error } from '../s3-helpers';

describe('prefixToEntry', () => {
  it('strips the trailing slash from the prefix in the path', () => {
    expect(prefixToEntry('mybucket', 'logs/', 'logs')).toEqual({
      name: 'logs',
      path: '/mybucket/logs',
      size: 0,
      modifiedAt: 0,
      isDirectory: true,
      isSymlink: false,
      isPrefix: true,
    });
  });

  it('preserves nested prefix segments', () => {
    const e = prefixToEntry('mybucket', 'logs/2026/', '2026');
    expect(e.path).toBe('/mybucket/logs/2026');
  });
});

describe('objectToEntry', () => {
  it('uses the LastModified timestamp in seconds', () => {
    const lastMod = new Date('2026-01-01T00:00:00Z');
    const e = objectToEntry(
      'mybucket',
      { Key: 'a/b.txt', Size: 42, LastModified: lastMod },
      'b.txt',
    );
    expect(e).toEqual({
      name: 'b.txt',
      path: '/mybucket/a/b.txt',
      size: 42,
      modifiedAt: Math.floor(lastMod.getTime() / 1000),
      isDirectory: false,
      isSymlink: false,
    });
  });

  it('falls back to 0 when LastModified is missing', () => {
    const e = objectToEntry('mybucket', { Key: 'a.txt', Size: 1 }, 'a.txt');
    expect(e.modifiedAt).toBe(0);
  });

  it('falls back to 0 size when Size is missing', () => {
    const e = objectToEntry('mybucket', { Key: 'a.txt' }, 'a.txt');
    expect(e.size).toBe(0);
  });
});

describe('wrapS3Error', () => {
  it('returns an existing S3StorageError unchanged', () => {
    const err = new S3StorageError('already wrapped');
    expect(wrapS3Error('list', err)).toBe(err);
  });

  it('returns an AbortError unchanged', () => {
    const err = new AbortError('cancelled');
    expect(wrapS3Error('upload', err)).toBe(err);
  });

  it('translates ExpiredToken (by name) into an actionable message', () => {
    const err = Object.assign(new Error('forbidden'), { name: 'ExpiredToken' });
    const wrapped = wrapS3Error('list', err);
    expect(wrapped).toBeInstanceOf(S3StorageError);
    expect(wrapped.message).toMatch(/session token has expired/);
  });

  it('translates ExpiredTokenException (when name is set) into the same message', () => {
    // Error.name has to actually be the SDK's code — the helper reads .name
    // first, then falls back to .Code. AWS SDK errors set .name to the
    // service code so this matches real-world payloads.
    const err = Object.assign(new Error('forbidden'), { name: 'ExpiredTokenException' });
    expect(wrapS3Error('list', err).message).toMatch(/session token has expired/);
  });

  it('detects expired-token by message text containing "expired token"', () => {
    const err = new Error('The provided expired token is invalid');
    expect(wrapS3Error('list', err).message).toMatch(/session token has expired/);
  });

  it('wraps an unknown error with the op name', () => {
    const err = new Error('NoSuchBucket');
    const wrapped = wrapS3Error('list-buckets', err);
    expect(wrapped).toBeInstanceOf(S3StorageError);
    expect(wrapped.message).toBe('S3 list-buckets failed: NoSuchBucket');
  });

  it('stringifies a non-Error throw', () => {
    const wrapped = wrapS3Error('upload', 'plain string failure');
    expect(wrapped.message).toBe('S3 upload failed: plain string failure');
  });

  it('tags throttling codes as retryable', () => {
    const err = Object.assign(new Error('slow down'), { name: 'SlowDown' });
    const wrapped = wrapS3Error('upload', err) as S3StorageError;
    expect(wrapped).toBeInstanceOf(S3StorageError);
    expect(wrapped.retryable).toBe(true);
  });

  it('tags 5xx by HTTP status as retryable', () => {
    const err = Object.assign(new Error('boom'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 503 },
    });
    expect((wrapS3Error('list', err) as S3StorageError).retryable).toBe(true);
  });

  it('does not tag auth/notfound errors as retryable', () => {
    const err = Object.assign(new Error('nope'), { name: 'AccessDenied' });
    expect((wrapS3Error('list', err) as S3StorageError).retryable).toBe(false);
  });

  it('expired-token errors are not retryable', () => {
    const err = Object.assign(new Error('forbidden'), { name: 'ExpiredToken' });
    expect((wrapS3Error('list', err) as S3StorageError).retryable).toBe(false);
  });
});
