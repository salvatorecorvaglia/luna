import type Database from 'better-sqlite3';
import { ErrorCode, LunarError } from '@shared/errors';
import type { ManualJumpHostConfig } from '@shared/types/connection';
import { assertBoundedInt, assertNonEmptyString } from './validate';

/**
 * Defense-in-depth cap on transient passphrase/password length passed
 * alongside a manual jump-host config. The credentials IPC and ssh-config
 * already enforce 4 KiB caps; this duplicates the constant so the
 * structural validator stays self-contained. Measured in UTF-8 bytes so a
 * multi-byte string can't slip past a char-count check.
 */
const MAX_SECRET_BYTES = 4096;

const VALID_AUTH_TYPES = new Set<ManualJumpHostConfig['authType']>([
  'password',
  'key',
  'key+passphrase',
]);

function validation(message: string): LunarError {
  return new LunarError(message, ErrorCode.VALIDATION_ERROR);
}

/**
 * Validate that `jumpHostConnectionId` points to a usable bastion row.
 * Throws a VALIDATION_ERROR with a user-friendly message on any violation.
 * Rules:
 *  - The id must exist.
 *  - The target row must be an SFTP connection (S3 has no notion of SSH).
 *  - It must not equal `selfId` (would create a 1-node cycle).
 *  - It must not itself have `jump_host_connection_id` set (single-hop only,
 *    until/unless multi-hop chains are added).
 *
 * Lifted from connection.ipc.ts so the SSH test-connection path can reuse
 * the exact same rules — otherwise an invalid jump-host id could pass the
 * test path and only blow up when the user saves the connection.
 */
export function assertValidJumpHost(
  db: Database.Database,
  jumpId: string,
  selfId: string | null,
): void {
  if (selfId && jumpId === selfId) {
    throw validation('A connection cannot use itself as a jump host');
  }
  const row = db
    .prepare('SELECT id, provider, jump_host_connection_id FROM connections WHERE id = ?')
    .get(jumpId) as
    | { id: string; provider: string; jump_host_connection_id: string | null }
    | undefined;

  if (!row) {
    throw validation('Jump host connection not found');
  }
  if (row.provider !== 'sftp') {
    throw validation('Only SFTP connections can be used as jump hosts');
  }
  if (row.jump_host_connection_id) {
    throw validation('Multi-hop jump host chains are not yet supported');
  }
}

/**
 * Validate the shape of an inline (manual) jump-host config. Used by every
 * code path that accepts user-supplied bastion settings — connection create,
 * connection update, and the SSH testConnection IPC — so a malformed config
 * surfaces as a structured VALIDATION_ERROR before reaching the wire.
 */
export function assertValidManualJumpHost(c: unknown): asserts c is ManualJumpHostConfig {
  if (c === null || typeof c !== 'object') {
    throw validation('jumpHostConfig must be an object');
  }
  const cfg = c as Partial<ManualJumpHostConfig>;
  assertNonEmptyString(cfg.host, 'jumpHostConfig.host');
  assertBoundedInt(cfg.port, 'jumpHostConfig.port', 1, 65535);
  assertNonEmptyString(cfg.username, 'jumpHostConfig.username');
  if (cfg.authType == null || !VALID_AUTH_TYPES.has(cfg.authType)) {
    throw validation(`jumpHostConfig.authType must be one of password|key|key+passphrase`);
  }
  if (cfg.privateKeyPath !== undefined && cfg.privateKeyPath !== null) {
    assertNonEmptyString(cfg.privateKeyPath, 'jumpHostConfig.privateKeyPath');
  }
  for (const [k, v] of Object.entries({ password: cfg.password, passphrase: cfg.passphrase })) {
    if (v === undefined) continue;
    if (typeof v !== 'string' || Buffer.byteLength(v, 'utf-8') > MAX_SECRET_BYTES) {
      throw validation(`jumpHostConfig.${k} must be a string up to ${MAX_SECRET_BYTES} bytes`);
    }
  }
}
