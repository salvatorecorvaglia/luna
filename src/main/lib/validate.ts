import { dirname, isAbsolute, resolve as resolvePath } from 'path';
import { homedir } from 'os';
import { realpath } from 'fs/promises';

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
}

export function assertBoundedInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

export function assertValidPath(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name);
  // Note: null-byte check is already handled by assertNonEmptyString
}

/**
 * Validate a local filesystem path supplied by the renderer.
 * Requires absolute, canonical (no `..` segments after resolve), no null bytes,
 * and confined to the user's home subtree so a compromised renderer can't
 * download to (or upload from) /etc, /var, or sibling user directories (S5).
 */
export function assertSafeAbsolutePath(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name);
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  const resolved = resolvePath(value);
  if (resolved !== value && resolved !== value.replace(/\/+$/, '')) {
    throw new Error(`${name} must be canonical (no '..' or redundant separators)`);
  }
  const home = homedir();
  if (resolved !== home && !resolved.startsWith(home + '/')) {
    throw new Error(`${name} must be inside the home directory`);
  }
}

/**
 * Expand a leading `~` to the user's real home directory and confine the
 * resolved path to that subtree. Falls back to lstat-based realpath only when
 * the file already exists, so callers can validate intent before opening (S3).
 *
 * Pass `requireExists: true` to also require the resolved path's real (symlink-
 * resolved) target stays inside home — used by SFTP transfer paths (S4).
 */
export async function expandAndConfineToHome(
  rawPath: string,
  name: string,
  options: { requireExists?: boolean } = {},
): Promise<string> {
  assertNonEmptyString(rawPath, name);
  const home = homedir();
  const expanded =
    rawPath === '~' ? home : rawPath.startsWith('~/') ? `${home}/${rawPath.slice(2)}` : rawPath;
  if (!isAbsolute(expanded)) {
    throw new Error(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  if (resolved !== home && !resolved.startsWith(home + '/')) {
    throw new Error(`${name} must be inside the home directory`);
  }
  if (options.requireExists) {
    const real = await realpath(resolved);
    if (real !== home && !real.startsWith(home + '/')) {
      throw new Error(`${name} resolves outside the home directory via symlink`);
    }
    return real;
  }
  return resolved;
}

/**
 * Async variant of assertSafeAbsolutePath that also follows symlinks.
 * For paths that already exist (uploads) we realpath the file. For paths that
 * do not yet exist (downloads), we realpath the *parent* directory so a symlink
 * inside the home dir pointing at /etc cannot be used to escape (S4).
 */
export async function assertSafeRealAbsolutePath(value: unknown, name: string): Promise<string> {
  assertSafeAbsolutePath(value, name);
  const home = homedir();
  try {
    const real = await realpath(value);
    if (real !== home && !real.startsWith(home + '/')) {
      throw new Error(`${name} resolves outside the home directory via symlink`);
    }
    return real;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw err;
    // Path does not exist yet — validate the parent directory's real target.
    const parent = dirname(value);
    const realParent = await realpath(parent);
    if (realParent !== home && !realParent.startsWith(home + '/')) {
      throw new Error(`${name} resolves outside the home directory via symlink`, { cause: err });
    }
    return value;
  }
}
