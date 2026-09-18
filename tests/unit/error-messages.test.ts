import { describe, expect, it } from 'vitest';
import { formatError, isCancellation, toastArgs } from '../../src/shared/error-messages';
import { ErrorCode, LunaError } from '../../src/shared/errors';

/**
 * This module is the funnel every user-facing error string in the app passes
 * through, and it was at ~8% coverage — the cheapest meaningful coverage in the
 * repo, since it is entirely pure functions.
 */
describe('formatError — LunaError', () => {
  it('uses the message as the title and the code description as the detail', () => {
    const { title, description, code } = formatError(
      new LunaError('Connection refused', ErrorCode.SSH_ERROR),
    );
    expect(title).toBe('Connection refused');
    expect(description).toBe('SSH connection error');
    expect(code).toBe(ErrorCode.SSH_ERROR);
  });

  it('demotes the message to the description when a prefix is supplied', () => {
    const { title, description } = formatError(
      new LunaError('Connection refused', ErrorCode.SSH_ERROR),
      'Could not connect',
    );
    expect(title).toBe('Could not connect');
    expect(description).toBe('Connection refused');
  });

  it('falls back to the code description when the message is empty', () => {
    const { title } = formatError(new LunaError('', ErrorCode.UNAUTHORIZED));
    expect(title).toBe('Authentication failed — check your credentials');
  });

  it('carries the code through for conditional UI', () => {
    expect(formatError(new LunaError('x', ErrorCode.CANCELLED)).code).toBe(ErrorCode.CANCELLED);
  });

  it.each([
    ErrorCode.INTERNAL_ERROR,
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.UNAUTHORIZED,
    ErrorCode.FORBIDDEN,
    ErrorCode.DATABASE_ERROR,
    ErrorCode.SSH_ERROR,
    ErrorCode.SFTP_ERROR,
    ErrorCode.S3_ERROR,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.CANCELLED,
    ErrorCode.AUTO_UPDATER_ERROR,
  ])('has a non-empty human description for %s', (code) => {
    // A missing entry would surface as `undefined` in a toast.
    const { title } = formatError(new LunaError('', code));
    expect(title).toBeTruthy();
    expect(title).not.toBe('undefined');
  });
});

describe('formatError — noisy prefixes', () => {
  // Main-process throws arrive with a class-name prefix that means nothing to
  // a user reading a toast.
  it.each([
    ['LunaError: disk is full', 'disk is full'],
    ['S3StorageError: bucket not found', 'bucket not found'],
    ['SftpStorageError: permission denied', 'permission denied'],
    ['Error: something broke', 'something broke'],
    ['error: lowercase prefix', 'lowercase prefix'],
  ])('strips %s', (input, expected) => {
    expect(formatError(new Error(input)).title).toBe(expected);
  });

  it('only strips a leading prefix, not one mid-message', () => {
    expect(formatError(new Error('failed: Error: nested')).title).toBe('failed: Error: nested');
  });
});

describe('formatError — plain values', () => {
  it('handles a bare Error', () => {
    const { title, description } = formatError(new Error('boom'));
    expect(title).toBe('boom');
    expect(description).toBeUndefined();
  });

  it('moves a bare Error message into the description under a prefix', () => {
    expect(formatError(new Error('boom'), 'Save failed')).toEqual({
      title: 'Save failed',
      description: 'boom',
    });
  });

  it.each([
    ['a string', 'just a string', 'just a string'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
  ])('stringifies %s', (_label, thrown, expected) => {
    expect(formatError(thrown).title).toBe(expected);
  });

  it('substitutes a generic message for a value that stringifies to nothing', () => {
    expect(formatError('').title).toBe('Something went wrong');
  });

  // Regression: `new Error('')` used to yield a blank toast title. The
  // non-Error branch already guarded against this; the Error branch did not.
  it('never returns an empty title, whatever was thrown', () => {
    for (const thrown of [undefined, '', new Error(''), new Error('Error: '), {}, []]) {
      expect(formatError(thrown).title, `for ${String(thrown)}`).toBeTruthy();
    }
  });
});

describe('isCancellation', () => {
  it('is true only for a CANCELLED LunaError', () => {
    expect(isCancellation(new LunaError('stopped', ErrorCode.CANCELLED))).toBe(true);
  });

  it.each([
    ['another LunaError code', new LunaError('nope', ErrorCode.SSH_ERROR)],
    ['a plain Error that says cancelled', new Error('Operation cancelled')],
    ['a string', 'cancelled'],
    ['null', null],
    ['undefined', undefined],
  ])('is false for %s', (_label, thrown) => {
    // Deliberately checked by code, not message: metadata does not cross the
    // IPC bridge, so the code is the only stable discriminator.
    expect(isCancellation(thrown)).toBe(false);
  });
});

describe('toastArgs', () => {
  it('spreads into toast.error(title, { description })', () => {
    const [title, opts] = toastArgs(new LunaError('nope', ErrorCode.S3_ERROR), 'Upload failed');
    expect(title).toBe('Upload failed');
    expect(opts).toEqual({ description: 'nope' });
  });

  it('returns a two-element tuple even with no prefix', () => {
    const args = toastArgs(new Error('boom'));
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('boom');
    expect(args[1].description).toBeUndefined();
  });
});
