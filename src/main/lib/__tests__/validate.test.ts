import { describe, expect, it } from 'vitest';
import { homedir } from 'os';
import {
  assertBoundedInt,
  assertNonEmptyString,
  assertSafeAbsolutePath,
  assertValidPath,
} from '../validate';

const HOME = homedir();

describe('assertNonEmptyString', () => {
  it('accepts a non-empty string', () => {
    expect(() => assertNonEmptyString('hello', 'name')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertNonEmptyString('', 'name')).toThrow(/non-empty string/);
  });

  it('rejects whitespace-only string', () => {
    expect(() => assertNonEmptyString('   ', 'name')).toThrow(/non-empty string/);
  });

  it('rejects non-string values', () => {
    expect(() => assertNonEmptyString(42, 'name')).toThrow(/non-empty string/);
    expect(() => assertNonEmptyString(null, 'name')).toThrow(/non-empty string/);
    expect(() => assertNonEmptyString(undefined, 'name')).toThrow(/non-empty string/);
  });

  it('rejects strings with null bytes', () => {
    expect(() => assertNonEmptyString('hello\0world', 'name')).toThrow(/null bytes/);
  });
});

describe('assertBoundedInt', () => {
  it('accepts values within bounds', () => {
    expect(() => assertBoundedInt(5, 'n', 1, 10)).not.toThrow();
    expect(() => assertBoundedInt(1, 'n', 1, 10)).not.toThrow();
    expect(() => assertBoundedInt(10, 'n', 1, 10)).not.toThrow();
  });

  it('rejects out-of-bound values', () => {
    expect(() => assertBoundedInt(0, 'n', 1, 10)).toThrow(/integer between/);
    expect(() => assertBoundedInt(11, 'n', 1, 10)).toThrow(/integer between/);
  });

  it('rejects non-integers', () => {
    expect(() => assertBoundedInt(1.5, 'n', 1, 10)).toThrow(/integer between/);
    expect(() => assertBoundedInt('5', 'n', 1, 10)).toThrow(/integer between/);
  });
});

describe('assertValidPath', () => {
  it('accepts valid paths', () => {
    expect(() => assertValidPath('/home/user/file.txt', 'path')).not.toThrow();
  });

  it('rejects empty paths', () => {
    expect(() => assertValidPath('', 'path')).toThrow();
  });

  it('rejects paths with null bytes', () => {
    expect(() => assertValidPath('/home/\0/x', 'path')).toThrow(/null bytes/);
  });
});
describe('assertSafeAbsolutePath', () => {
  it('accepts an absolute, canonical path inside home', () => {
    expect(() => assertSafeAbsolutePath(`${HOME}/file.txt`, 'p')).not.toThrow();
    expect(() => assertSafeAbsolutePath(HOME, 'p')).not.toThrow();
  });

  it('accepts an absolute path with trailing slash', () => {
    expect(() => assertSafeAbsolutePath(`${HOME}/sub/`, 'p')).not.toThrow();
  });

  it('rejects relative paths', () => {
    expect(() => assertSafeAbsolutePath('./file.txt', 'p')).toThrow(/absolute/);
    expect(() => assertSafeAbsolutePath('file.txt', 'p')).toThrow(/absolute/);
  });

  it('rejects paths with traversal segments', () => {
    expect(() => assertSafeAbsolutePath(`${HOME}/../etc/passwd`, 'p')).toThrow(/canonical/);
  });

  it('rejects paths with redundant separators', () => {
    expect(() => assertSafeAbsolutePath(`${HOME}//user`, 'p')).toThrow(/canonical/);
  });

  it('rejects paths with null bytes', () => {
    expect(() => assertSafeAbsolutePath(`${HOME}/\0/x`, 'p')).toThrow(/null bytes/);
  });

  it('rejects paths outside the home directory', () => {
    expect(() => assertSafeAbsolutePath('/etc/passwd', 'p')).toThrow(/home directory/);
    expect(() => assertSafeAbsolutePath('/var/log', 'p')).toThrow(/home directory/);
  });
});
