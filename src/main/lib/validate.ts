import { lstat, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, normalize, relative, resolve as resolvePath, sep } from 'node:path';
import { ErrorCode, LunarError } from '@shared/errors';

/**
 * Validation throws a `LunarError(VALIDATION_ERROR)` so the renderer receives
 * a structured code instead of the catch-all INTERNAL_ERROR that `new Error`
 * decays to inside `registerHandler`. Callers that pre-date this change
 * already caught the same message text, so the upgrade is backwards-
 * compatible.
 */
export function validationError(message: string): LunarError {
  return new LunarError(message, ErrorCode.VALIDATION_ERROR);
}

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`${name} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw validationError(`${name} must not contain null bytes`);
  }
}

export function assertBoundedInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${name} must be an integer between ${min} and ${max}`);
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
export function isInsideDir(child: string, parent: string): boolean {
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
    throw validationError(`${name} must be an absolute path`);
  }
  // Compare to path.normalize (cross-platform) rather than resolve(), which
  // would silently rewrite a non-canonical input into a valid-looking one.
  if (stripTrailingSep(value) !== stripTrailingSep(normalize(value))) {
    throw validationError(`${name} must be canonical (no '..' or redundant separators)`);
  }
  const resolved = resolvePath(value);
  const home = homedir();
  if (!isInsideDir(resolved, home)) {
    throw new LunarError(`${name} must be inside the home directory`, ErrorCode.FORBIDDEN);
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
    throw validationError(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  if (!isInsideDir(resolved, home)) {
    throw new LunarError(`${name} must be inside the home directory`, ErrorCode.FORBIDDEN);
  }
  if (options.requireExists) {
    const real = await realpath(resolved);
    if (!isInsideDir(real, home)) {
      throw new LunarError(
        `${name} resolves outside the home directory via symlink`,
        ErrorCode.FORBIDDEN,
      );
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
    throw validationError(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  if (!isInsideDir(resolved, home)) {
    throw new LunarError(`${name} must be inside the home directory`, ErrorCode.FORBIDDEN);
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
    const ls = await lstat(value);
    if (ls.isSymbolicLink()) {
      const linkTarget = await readlink(value);
      const targetPath = isAbsolute(linkTarget)
        ? linkTarget
        : resolvePath(dirname(value), linkTarget);
      if (!isInsideDir(targetPath, home)) {
        throw new LunarError(
          `${name} resolves outside the home directory via symlink`,
          ErrorCode.FORBIDDEN,
        );
      }
    }
    const real = await realpath(value);
    if (!isInsideDir(real, home)) {
      throw new LunarError(
        `${name} resolves outside the home directory via symlink`,
        ErrorCode.FORBIDDEN,
      );
    }
    return real;
  } catch (err: unknown) {
    if (err instanceof LunarError) throw err;
    if ((err as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw err;
    // Path does not exist yet — validate the parent directory's real target.
    const parent = dirname(value);
    const realParent = await realpath(parent);
    if (!isInsideDir(realParent, home)) {
      throw new LunarError(
        `${name} resolves outside the home directory via symlink`,
        ErrorCode.FORBIDDEN,
        { cause: String(err) },
      );
    }
    return value;
  }
}

/**
 * Expand a leading `~` to the user's real home directory and validate that the
 * private key path is an absolute path that exists. Note: private keys are
 * intentionally exempt from home-confinement validation, allowing users to
 * target keys located in standard system directories (e.g., /etc/ssh/ or custom
 * secure mount points) outside their home subtree.
 */
export async function expandAndValidatePrivateKeyPath(
  rawPath: string,
  name: string,
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
    throw validationError(`${name} must be absolute or start with ~`);
  }
  const resolved = resolvePath(expanded);
  const real = await realpath(resolved);
  return real;
}

/**
 * Synchronous expansion + validation (no symlink follow or existence check).
 * Used inside connection import to canonicalize key paths without blocking disk I/O.
 */
export function expandAndValidatePrivateKeyPathSync(rawPath: string, name: string): string {
  assertNonEmptyString(rawPath, name);
  const home = homedir();
  const expanded =
    rawPath === '~'
      ? home
      : rawPath.startsWith('~/') || rawPath.startsWith('~\\')
        ? `${home}${sep}${rawPath.slice(2)}`
        : rawPath;
  if (!isAbsolute(expanded)) {
    throw validationError(`${name} must be absolute or start with ~`);
  }
  return resolvePath(expanded);
}
