import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'fs';
import {
  assertBoundedInt,
  assertNonEmptyString,
  assertSafeAbsolutePath,
  assertSafeRealAbsolutePath,
  assertValidPath,
  expandAndConfineToHome,
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

describe('expandAndConfineToHome', () => {
  it('expands a leading ~ to the home directory', async () => {
    await expect(expandAndConfineToHome('~/keys/id_rsa', 'p')).resolves.toBe(`${HOME}/keys/id_rsa`);
  });

  it('expands a bare ~ to the home directory', async () => {
    await expect(expandAndConfineToHome('~', 'p')).resolves.toBe(HOME);
  });

  it('rejects non-absolute, non-tilde paths', async () => {
    await expect(expandAndConfineToHome('relative/path', 'p')).rejects.toThrow(/absolute or start with ~/);
  });

  it('rejects paths that escape via .. after expansion', async () => {
    await expect(expandAndConfineToHome('~/../etc/passwd', 'p')).rejects.toThrow(/home directory/);
  });

  it('rejects absolute paths outside home', async () => {
    await expect(expandAndConfineToHome('/etc/passwd', 'p')).rejects.toThrow(/home directory/);
  });

  it('does not mistake ~user for the current user (treats it as a literal absolute requirement)', async () => {
    // The helper only special-cases bare `~` and `~/...`; `~root/foo` must be
    // rejected as non-absolute rather than silently rewritten.
    await expect(expandAndConfineToHome('~root/foo', 'p')).rejects.toThrow(/absolute/);
  });
});

describe('assertSafeRealAbsolutePath (symlink-following)', () => {
  // Symlinks rooted at a tmp dir we link from inside HOME, so the symlink
  // itself lives in home but its target resolves outside.
  let homeTmp: string;
  let outsideTmp: string;
  let escapeLink: string; // <home>/escape -> /tmp/<outside>
  let safeFile: string;

  beforeAll(() => {
    homeTmp = mkdtempSync(join(HOME, '.lunar-test-'));
    outsideTmp = mkdtempSync(join(tmpdir(), 'lunar-outside-'));
    escapeLink = join(homeTmp, 'escape');
    symlinkSync(outsideTmp, escapeLink);
    safeFile = join(homeTmp, 'safe.txt');
    writeFileSync(safeFile, 'ok');
    mkdirSync(join(homeTmp, 'sub'));
  });

  afterAll(() => {
    try {
      rmSync(homeTmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    try {
      rmSync(outsideTmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('returns the realpath when target is inside home', async () => {
    await expect(assertSafeRealAbsolutePath(safeFile, 'p')).resolves.toBe(safeFile);
  });

  it('rejects an existing symlink whose target escapes home', async () => {
    // Pretend the renderer is asking us to write into a file that already
    // exists via a planted symlink. realpath() resolves it to /tmp/...
    // which is outside home, so we must refuse.
    const linkedFile = join(escapeLink, 'pwned');
    writeFileSync(linkedFile, 'attack');
    await expect(assertSafeRealAbsolutePath(linkedFile, 'p')).rejects.toThrow(
      /resolves outside the home directory/,
    );
  });

  it('uses parent realpath for non-existent targets', async () => {
    // For downloads, the destination file may not exist yet. The validator
    // should walk back to the parent and verify *its* real target is in home.
    const newFile = join(homeTmp, 'sub', 'new-download.bin');
    await expect(assertSafeRealAbsolutePath(newFile, 'p')).resolves.toBe(newFile);
  });

  it('rejects writing into a non-existent file under an escaping symlink parent', async () => {
    const newFile = join(escapeLink, 'new.bin');
    await expect(assertSafeRealAbsolutePath(newFile, 'p')).rejects.toThrow(
      /resolves outside the home directory/,
    );
  });
});
