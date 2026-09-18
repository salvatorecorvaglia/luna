import { IPC, LIMITS } from '@shared/constants';
import { type AppSettings, DEFAULT_SETTINGS } from '@shared/types/settings';
import { invalidateRuntimeCache, RUNTIME_BOUNDS } from '../config/runtime';
import { registerHandler } from '../lib/ipc-handler';
import { validationError } from '../lib/validate';
import { getDatabase } from '../services/database';
import { transferQueue } from '../services/transfer-queue';

/**
 * Per-key value type guards. Values arrive from the renderer as JSON-encoded
 * strings (`'14'`, `'"dracula"'`, `'true'`); after parsing we enforce shape so
 * a misbehaving renderer can't poison the settings table with a type the rest
 * of the app doesn't expect.
 *
 * Derived from `DEFAULT_SETTINGS` rather than hand-maintained: the old
 * hand-written table silently omitted several keys the main process actually
 * reads (`ssh.connectTimeoutMs`, every `sftp.*`/`s3.*` tunable), so
 * `SETTINGS_SET` rejected them and they were permanently stuck at their
 * defaults. Deriving the table makes that class of drift impossible.
 */
type SettingTypeName = 'string' | 'number' | 'boolean';

const SETTING_TYPES = Object.fromEntries(
  Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, typeof value as SettingTypeName]),
) as Record<keyof AppSettings, SettingTypeName>;

const VALID_SETTINGS_KEYS = new Set(Object.keys(SETTING_TYPES));

/**
 * Inclusive bounds for numeric settings. Anything outside this range is
 * rejected during SETTING_SET. Without these, a renderer could write
 * `Number.MAX_SAFE_INTEGER` or `0` and put the consumer (e.g. transfer queue
 * concurrency) into a wedged state. `Number.isFinite` in `checkSettingType`
 * already strips NaN/Infinity, but doesn't bound the magnitude.
 *
 * Transport tunables reuse the exact table `config/runtime.ts` enforces on
 * read, so the write path can never accept a value the read path will discard.
 */
const SETTING_NUMERIC_BOUNDS: Partial<Record<keyof AppSettings, { min: number; max: number }>> = {
  'terminal.fontSize': { min: LIMITS.MIN_FONT_SIZE, max: 72 },
  'terminal.scrollback': { min: LIMITS.MIN_SCROLLBACK, max: 1_000_000 },
  'transfer.concurrency': { min: 1, max: LIMITS.MAX_CONCURRENT_TRANSFERS },
  'ssh.keepAliveInterval': { min: 0, max: 600_000 },
  'ssh.maxReconnectAttempts': { min: 0, max: 100 },
  'ssh.readyTimeout': { min: 1_000, max: 600_000 },
  'ssh.connectTimeoutMs': { min: 1_000, max: 600_000 },
  ...(RUNTIME_BOUNDS as Partial<Record<keyof AppSettings, { min: number; max: number }>>),
};

function checkSettingType(key: string, parsed: unknown): boolean {
  const expected = SETTING_TYPES[key as keyof AppSettings];
  if (!expected) return false;
  if (expected === 'number') {
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return false;
    const bounds = SETTING_NUMERIC_BOUNDS[key as keyof AppSettings];
    if (bounds && (parsed < bounds.min || parsed > bounds.max)) return false;
    return true;
  }
  return typeof parsed === expected;
}

function assertKnownKey(key: string): asserts key is keyof AppSettings {
  if (typeof key !== 'string' || !VALID_SETTINGS_KEYS.has(key)) {
    throw validationError(`Unknown setting key: ${String(key)}`);
  }
}

export function registerSettingsHandlers(): void {
  // Note: `getDatabase()` is resolved per-call, not captured at registration
  // time. `closeDatabase()` (quit, or a test swapping the handle) used to
  // leave these handlers holding a closed connection.

  registerHandler(IPC.SETTINGS_GET, (_event, key: string) => {
    assertKnownKey(key);
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    // Return the *parsed* value so this matches SETTINGS_GET_ALL. The two
    // used to disagree — `get` handed back the raw JSON string while
    // `getAll` returned decoded values — which meant a caller that switched
    // between them silently got `'"dracula"'` instead of `'dracula'`.
    try {
      const parsed = JSON.parse(row.value);
      return checkSettingType(key, parsed) ? (parsed as AppSettings[keyof AppSettings]) : null;
    } catch {
      return null;
    }
  });

  registerHandler(IPC.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    assertKnownKey(key);
    if (typeof value !== 'string') {
      throw validationError(`Setting ${key} must be sent as a JSON-encoded string`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw validationError(`Setting ${key} must be JSON-encoded`);
    }
    if (!checkSettingType(key, parsed)) {
      const bounds = SETTING_NUMERIC_BOUNDS[key];
      throw validationError(
        bounds
          ? `Setting ${key} must be a number between ${bounds.min} and ${bounds.max}`
          : `Setting ${key} has wrong type (expected ${SETTING_TYPES[key]})`,
      );
    }

    // Re-serialise from the parsed value so what we store is canonical JSON
    // (`' 14 '` and `'14'` both become `14`) rather than whatever spacing the
    // renderer happened to send.
    const canonical = JSON.stringify(parsed);
    getDatabase()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, canonical);

    if (key === 'transfer.concurrency') {
      transferQueue.setMaxConcurrent(parsed as number);
    }
    // Transport tunables are snapshotted on first use; drop the snapshot so
    // the new value takes effect without a restart.
    invalidateRuntimeCache();
  });

  registerHandler(IPC.SETTINGS_GET_ALL, () => {
    const rows = getDatabase().prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      // Skip stored rows that don't match the expected schema — a stale row
      // from a previous install must not break the renderer.
      try {
        const parsed = JSON.parse(row.value);
        if (checkSettingType(row.key, parsed)) {
          settings[row.key] = parsed;
        }
      } catch {
        // Drop unparseable rows silently.
      }
    }
    return settings;
  });
}
