/**
 * Centralised runtime tunables.
 *
 * Each value is sourced in priority order:
 *   1. The `settings` row keyed by `<group>.<name>` (user-overridable via
 *      the in-app Settings UI or a manual sqlite edit).
 *   2. A compile-time default exported as `DEFAULTS` below.
 *
 * The "central place to grep" pattern matters for SFTP/S3 timing knobs:
 * before this module, `IDLE_TIMEOUT_MS = 5 * 60 * 1000` was buried inside
 * sftp-manager.ts and `partSize: 5 * 1024 * 1024` inside s3-provider.ts —
 * tuning either required editing the service and rebuilding, with no
 * runtime override path. Pull every tunable through here so a power-user
 * with a fast link can raise S3 multipart concurrency without a rebuild.
 *
 * The hard `LIMITS` exposed from @shared/constants stay where they are
 * because they're shared with the renderer (UI clamps depend on them).
 * This module is for main-process-only tunables that the renderer never
 * needs to see.
 */
import { getSetting } from '../services/database';

export const DEFAULTS = {
  /** Idle window after which an SFTP subsystem is closed to free server resources. */
  SFTP_IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  /** Sweep interval for the idle SFTP-session sweeper. */
  SFTP_IDLE_CHECK_INTERVAL_MS: 60 * 1000,
  /**
   * Delay after destroy() before unlinking a partial transfer file. Gives
   * the write stream time to flush its destroy ack so unlink doesn't race
   * a still-in-flight write. Tightening below ~25ms risks the race;
   * widening above ~250ms makes cancel feel sluggish.
   */
  SFTP_ABORT_CLEANUP_DELAY_MS: 50,
  /** Base delay before the first reconnect attempt. Doubles up to the cap below. */
  SSH_RECONNECT_BASE_DELAY_MS: 1_000,
  /** Cap on exponential reconnect backoff. */
  SSH_RECONNECT_MAX_DELAY_MS: 30_000,
  /** Parts kept in flight per S3 multipart upload. AWS SDK default is 4. */
  S3_UPLOAD_QUEUE_SIZE: 4,
  /** Bytes per multipart part. Must be ≥ 5 MiB per S3 spec. */
  S3_UPLOAD_PART_SIZE_BYTES: 5 * 1024 * 1024,
} as const;

type DefaultsShape = typeof DEFAULTS;

/** Settings-keys mirrored 1:1 with DEFAULTS so tests can audit the contract. */
export const SETTING_KEYS: Record<keyof DefaultsShape, string> = {
  SFTP_IDLE_TIMEOUT_MS: 'sftp.idleTimeoutMs',
  SFTP_IDLE_CHECK_INTERVAL_MS: 'sftp.idleCheckIntervalMs',
  SFTP_ABORT_CLEANUP_DELAY_MS: 'sftp.abortCleanupDelayMs',
  SSH_RECONNECT_BASE_DELAY_MS: 'ssh.reconnectBaseDelayMs',
  SSH_RECONNECT_MAX_DELAY_MS: 'ssh.reconnectMaxDelayMs',
  S3_UPLOAD_QUEUE_SIZE: 's3.uploadQueueSize',
  S3_UPLOAD_PART_SIZE_BYTES: 's3.uploadPartSizeBytes',
};

/**
 * Look up a tunable, falling back to the compile-time default. Each call
 * goes through better-sqlite3 (sync), which is fine for one-off boot/init
 * reads but should not be invoked inside a hot loop — capture the value
 * in a module-level constant if it's read per-request.
 *
 * Returns the default (not the stored value) when:
 *  - the DB isn't yet open (early module-load reads in services constructed
 *    at import time, plus unit tests that don't bring up a sqlite handle),
 *  - the stored value parses as the wrong shape, or
 *  - for numeric tunables, the stored value falls outside the safe range
 *    encoded below — so a malformed setting row can't pin a timer at 0ms
 *    or hand the S3 client a 1-byte partSize.
 */
export function getRuntimeNumber<K extends keyof DefaultsShape>(name: K): number {
  let raw: unknown;
  try {
    raw = getSetting<unknown>(SETTING_KEYS[name], DEFAULTS[name]);
  } catch {
    // Database may not be open yet (module-load on a fresh process, or unit
    // tests that import the service without bootstrapping the DB). Defaults
    // are safe — services that need a settings-overridable value at runtime
    // re-read on demand inside their methods.
    return DEFAULTS[name];
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULTS[name];
  }
  // Per-tunable bounds: refuse obviously wrong overrides rather than
  // letting a bad settings row break the SFTP/S3 layer at runtime.
  switch (name) {
    case 'S3_UPLOAD_PART_SIZE_BYTES':
      // S3 requires ≥ 5 MiB parts; cap at 256 MiB to keep RAM in check.
      if (raw < 5 * 1024 * 1024 || raw > 256 * 1024 * 1024) return DEFAULTS[name];
      break;
    case 'S3_UPLOAD_QUEUE_SIZE':
      if (raw < 1 || raw > 32) return DEFAULTS[name];
      break;
    case 'SFTP_ABORT_CLEANUP_DELAY_MS':
      if (raw < 25 || raw > 1_000) return DEFAULTS[name];
      break;
    case 'SFTP_IDLE_TIMEOUT_MS':
    case 'SFTP_IDLE_CHECK_INTERVAL_MS':
    case 'SSH_RECONNECT_BASE_DELAY_MS':
    case 'SSH_RECONNECT_MAX_DELAY_MS':
      // Keep timers between 100ms and 24h.
      if (raw < 100 || raw > 24 * 60 * 60 * 1000) return DEFAULTS[name];
      break;
  }
  return raw;
}
