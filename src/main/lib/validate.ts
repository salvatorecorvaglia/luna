import { dirname, isAbsolute, normalize, relative, resolve as resolvePath, sep } from 'path';
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
 * True if `child` is `parent` or a descendant of it. Uses path.relative so the
 * check is correct on both POSIX (`/`) and Windows (`\`, plus drive letters)
 * — naive `startsWith(parent + '/')` checks miss Windows separators and let
 * sibling-prefix paths like `/home/foo-attacker` slip through.
 */
function isInsideDir(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  if (rel.length === 0) return true;
  if (isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false;
  return true;
}

/**
 * Strip a trailing separator (POSIX `/` or Windows `\`). Used so callers can
 * supply `~/sub/` interchangeably with `~/sub` without the canonicalisation
 * check rejecting them.
 */
function stripTrailingSep(p: string): string {
  if (p.length <= 1) return p;
  return p.replace(/[\\/]+$/, '');
}

/**
 * Validate a local filesystem path supplied by the renderer.
 * Requires absolute, canonical (no `..` segments after resolve), no null bytes,
 * and confined to the user's home subtree so a compromised renderer can't
 * download to (or upload from) /etc, /var, or sibling user directories.
 */
export function assertSafeAbsolutePath(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name);
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  // Compare to path.normalize (cross-platform) rather than resolve(), which
  // would silently rewrite a non-canonical input into a valid-looking one.
  if (stripTrailingSep(value) !== stripTrailingSep(normalize(value))) {
    throw new Error(`${name} must be canonical (no '..' or redundant separators)`);
  }
  const resolved = resolvePath(value);
  const home = homedir();
  if (!isInsideDir(resolved, home)) {
    throw new Error(`${name} must be inside the home directory`);
  }
}

/**
 * Expand a leading `~` to the user's real home directory and confine the
 * resolved path to that subtree. Falls back to lstat-based realpath only when
 * the file already exists, so callers can validate intent before opening.
 *
 * Pass `requireExists: true` to also require the resolved path's real (symlink-
 * resolved) target stays inside home — used by SFTP transfer paths.
 */
export async function expandAndConfineToHome(
  rawPath: string,
  name: string,
  options: { requireExists?: boolean } = {},
): Promise<string> {
  assertNonEmptyString(rawPath, name);
  const home = homedir();
  const expanded =
    rawPath === '~'
      ? home
      : rawPath.startsWith('~/') || rawPath.startsWith('~\\')
        ? `${home}${sep}${rawPath.slice(2)}`
        : rawPath;
  if (!isAbsolute(expanded)) {
    throw new Error(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  if (!isInsideDir(resolved, home)) {
    throw new Error(`${name} must be inside the home directory`);
  }
  if (options.requireExists) {
    const real = await realpath(resolved);
    if (!isInsideDir(real, home)) {
      throw new Error(`${name} resolves outside the home directory via symlink`);
    }
    return real;
  }
  return resolved;
}

/**
 * Synchronous expansion + home-confinement (no symlink follow).
 * Used inside synchronous code paths (e.g. SQLite transactions during connection
 * import) where async `realpath` isn't an option. The returned path is the
 * resolved (canonical) absolute path; callers should still validate the actual
 * file exists when they open it.
 */
export function expandAndConfineToHomeSync(rawPath: string, name: string): string {
  assertNonEmptyString(rawPath, name);
  const home = homedir();
  const expanded =
    rawPath === '~'
      ? home
      : rawPath.startsWith('~/') || rawPath.startsWith('~\\')
        ? `${home}${sep}${rawPath.slice(2)}`
        : rawPath;
  if (!isAbsolute(expanded)) {
    throw new Error(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  if (!isInsideDir(resolved, home)) {
    throw new Error(`${name} must be inside the home directory`);
  }
  return resolved;
}

/**
 * Async variant of assertSafeAbsolutePath that also follows symlinks.
 * For paths that already exist (uploads) we realpath the file. For paths that
 * do not yet exist (downloads), we realpath the *parent* directory so a symlink
 * inside the home dir pointing at /etc cannot be used to escape.
 */
export async function assertSafeRealAbsolutePath(value: unknown, name: string): Promise<string> {
  assertSafeAbsolutePath(value, name);
  const home = homedir();
  try {
    const real = await realpath(value);
    if (!isInsideDir(real, home)) {
      throw new Error(`${name} resolves outside the home directory via symlink`);
    }
    return real;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw err;
    // Path does not exist yet — validate the parent directory's real target.
    const parent = dirname(value);
    const realParent = await realpath(parent);
    if (!isInsideDir(realParent, home)) {
      throw new Error(`${name} resolves outside the home directory via symlink`, { cause: err });
    }
    return value;
  }
}
