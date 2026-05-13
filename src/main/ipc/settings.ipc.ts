import { IPC, LIMITS } from '@shared/constants';
import { ErrorCode, LunarError } from '@shared/errors';
import { getDatabase } from '../services/database';
import { transferQueue } from '../services/transfer-queue';
import type { AppSettings } from '@shared/types/settings';
import { registerHandler } from '../lib/ipc-handler';

function validation(message: string): LunarError {
  return new LunarError(message, ErrorCode.VALIDATION_ERROR);
}

/** Per-key value type guards. Values arrive from the renderer as JSON-encoded
 * strings (`'14'`, `'"dracula"'`, `'true'`); after parsing we enforce shape so
 * a misbehaving renderer can't poison the settings table with a type the rest
 * of the app doesn't expect. */
type SettingTypeName = 'string' | 'number' | 'boolean';
const SETTING_TYPES: Record<keyof AppSettings, SettingTypeName> = {
  'terminal.fontFamily': 'string',
  'terminal.fontSize': 'number',
  'terminal.theme': 'string',
  'terminal.scrollback': 'number',
  'transfer.concurrency': 'number',
  'ssh.autoReconnect': 'boolean',
  'ssh.keepAliveInterval': 'number',
  'ssh.maxReconnectAttempts': 'number',
  'ssh.readyTimeout': 'number',
  'ui.applyTerminalTheme': 'boolean',
};
const VALID_SETTINGS_KEYS = new Set(Object.keys(SETTING_TYPES));

/**
 * Inclusive bounds for numeric settings. Anything outside this range will be
 * rejected during SETTING_SET. Without these, a renderer could write
 * `Number.MAX_SAFE_INTEGER` or `0` and put the consumer (e.g. transfer queue
 * concurrency) into a wedged state. `Number.isFinite` in `checkSettingType`
 * already strips NaN/Infinity, but doesn't bound the magnitude.
 */
const SETTING_NUMERIC_BOUNDS: Partial<Record<keyof AppSettings, { min: number; max: number }>> = {
  'terminal.fontSize': { min: 8, max: 72 },
  'terminal.scrollback': { min: LIMITS.MIN_SCROLLBACK, max: 1_000_000 },
  'transfer.concurrency': { min: 1, max: LIMITS.MAX_CONCURRENT_TRANSFERS },
  'ssh.keepAliveInterval': { min: 0, max: 600_000 },
  'ssh.maxReconnectAttempts': { min: 0, max: 100 },
  'ssh.readyTimeout': { min: 1_000, max: 600_000 },
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

export function registerSettingsHandlers(): void {
  const db = getDatabase();

  registerHandler(IPC.SETTINGS_GET, (_event, key: string) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw validation(`Unknown setting key: ${key}`);
    }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  });

  registerHandler(IPC.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw validation(`Unknown setting key: ${key}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw validation(`Setting ${key} must be JSON-encoded`);
    }
    if (!checkSettingType(key, parsed)) {
      throw validation(`Setting ${key} has wrong type`);
    }
    let v = value;
    if (key === 'terminal.scrollback') {
      const n = Math.max(LIMITS.MIN_SCROLLBACK, Math.min(1_000_000, (parsed as number) || 10000));
      v = JSON.stringify(n);
    } else if (key === 'transfer.concurrency') {
      const n = Math.max(1, Math.min(LIMITS.MAX_CONCURRENT_TRANSFERS, (parsed as number) || 3));
      v = JSON.stringify(n);
      transferQueue.setMaxConcurrent(n);
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, v);
  });

  registerHandler(IPC.SETTINGS_GET_ALL, () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
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
