import { isAbsolute, resolve as resolvePath } from 'path';
import { homedir } from 'os';

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
