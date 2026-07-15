import type { AuthType } from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import log from '../lib/logger';
import { type Migration, migrations as migrationList } from './db/migrations';

/**
 * Explicit column list for `SELECT` against `connections` when the caller
 * needs the full `ConnectionRow` shape (i.e. anything that pipes through
 * `rowToConnection`). Mirrors the fields below so a rename surfaces as a
 * SQL error at the call site instead of silently producing `undefined`.
 * Narrower call sites should inline their own projection.
 */
export const CONNECTION_COLUMNS = [
  'id',
  'name',
  'provider',
  'host',
  'port',
  'username',
  'auth_type',
  'private_key_path',
  'endpoint',
  'region',
  'default_bucket',
  'force_path_style',
  'folder',
  'color_tag',
  'sort_order',
  'jump_host_connection_id',
  'jump_host_host',
  'jump_host_port',
  'jump_host_username',
  'jump_host_auth_type',
  'jump_host_private_key_path',
  'is_hidden',
  'last_connected_at',
  'keepalive_interval',
  'keepalive_count_max',
  'port_forwards',
  'created_at',
  'updated_at',
].join(', ');

/** Shape of a row in the `connections` table (snake_case DB columns). */
export interface ConnectionRow {
  id: string;
  name: string;
  provider: StorageProviderKind;
  host: string | null;
  port: number | null;
  username: string | null;
  auth_type: AuthType | null;
  private_key_path: string | null;
  endpoint: string | null;
  region: string | null;
  default_bucket: string | null;
  /** SQLite has no native boolean — 0/1 or null. */
  force_path_style: number | null;
  folder: string;
  color_tag: string | null;
  sort_order: number;
  startup_command: string | null;
  /**
   * Optional id of another connection in this same table to use as a jump
   * host. Enforced by FK `ON DELETE SET NULL` so deleting the bastion row
   * clears the reference instead of leaving a dangling pointer.
   */
  jump_host_connection_id: string | null;
  /** Manual jump host fields */
  jump_host_host: string | null;
  jump_host_port: number | null;
  jump_host_username: string | null;
  jump_host_auth_type: string | null;
  jump_host_private_key_path: string | null;
  /** Whether this connection should be hidden from the main sidebar list. */
  is_hidden: number;
  last_connected_at: number | null;
  keepalive_interval: number | null;
  keepalive_count_max: number | null;
  port_forwards: string | null;
  created_at: number;
  updated_at: number;
}

let db: Database.Database | null = null;
/**
 * Re-entrancy guard: a migration calling out to helper code that itself
 * needs `getDatabase()` would otherwise either (a) re-enter and open a
 * second sqlite connection holding a competing file lock, or (b) recurse
 * indefinitely. Once `db` is assigned we always return it; the flag is
 * only here to make the contract explicit and to give a clear error if
 * a migration triggers re-entry *before* the assignment.
 */
let initializing = false;

export function getDatabase(): Database.Database {
  if (db) return db;
  if (initializing) {
    // We're inside the first call's initialization (a migration helper called
    // getDatabase()) and the db handle isn't installed yet. Refuse rather
    // than open a second handle that would race the first on the same file.
    throw new Error(
      '[database] getDatabase() called re-entrantly during initialization — ' +
        'migrations must use the local handle they were passed.',
    );
  }

  initializing = true;
  try {
    const userDataPath = app.getPath('userData');
    const dbDir = join(userDataPath, 'data');

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = join(dbDir, 'lunar.db');
    const handle = new Database(dbPath);

    // Enable WAL mode for better concurrent performance
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');

    // Check database integrity. A corrupt sqlite file would otherwise let
    // every later read return undefined or partial rows, silently producing
    // a broken UI. Throw so the main process can surface a recoverable
    // dialog (restore from backup / reset data dir) instead of proceeding
    // against a damaged store.
    const integrityResult = handle.pragma('integrity_check') as { integrity_check: string }[];
    if (integrityResult[0]?.integrity_check !== 'ok') {
      log.error('[database] Integrity check failed:', integrityResult);
      try {
        handle.close();
      } catch {
        // ignore — about to throw anyway
      }
      throw new Error(
        `Database integrity check failed: ${JSON.stringify(integrityResult)}. ` +
          `The lunar.db file may be corrupt; restore from backup or remove the data directory.`,
      );
    }

    // Install the handle *before* migrations run so any helper that calls
    // getDatabase() recursively (legacy code paths, retired migration utils)
    // gets the same instance instead of recursing.
    db = handle;
    runMigrations(handle);
    return handle;
  } catch (err) {
    // Roll back the global so the next caller can retry from a clean slate.
    if (db) {
      try {
        db.close();
      } catch {
        // ignore — already broken
      }
      db = null;
    }
    throw err;
  } finally {
    initializing = false;
  }
}

/**
 * Thrown when a migration fails. The main process catches this at startup so
 * the user sees a recoverable error dialog instead of a hard crash.
 */
export class MigrationError extends Error {
  constructor(
    public readonly migrationName: string,
    cause: unknown,
  ) {
    super(
      `Database migration "${migrationName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'MigrationError';
  }
}

function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const migrations = getMigrations();
  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const insertMigration = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    // A malformed migration would otherwise propagate out of getDatabase()
    // and crash the main process before any UI is shown. Wrap each migration
    // in its own try so we can surface the offending name to the user.
    try {
      const transaction = db.transaction(() => {
        db!.exec(migration.sql);
        insertMigration.run(migration.name);
      });
      transaction();
      // Run an integrity check after each migration: a migration that
      // half-applied before throwing would have rolled back, but DDL bugs
      // (corrupt indexes, FK violations once enforced) can leave the file
      // structurally inconsistent without raising on the transaction itself.
      const result = db.pragma('integrity_check') as { integrity_check: string }[];
      if (result[0]?.integrity_check !== 'ok') {
        throw new Error(`integrity_check after migration returned: ${JSON.stringify(result)}`);
      }
      log.info(`[DB] Applied migration: ${migration.name}`);
    } catch (err) {
      log.error(`[DB] Migration "${migration.name}" failed:`, err);
      throw new MigrationError(migration.name, err);
    }
  }
}

/**
 * Migration list now lives one-per-file under `./db/migrations/`. This thin
 * accessor preserves the existing internal call signature and the
 * `__test__.getMigrations` shape so tests don't need to change. Adding a
 * new migration means dropping a new file in that directory and appending
 * an entry to its index — no change to this module.
 */
function getMigrations(): Migration[] {
  return migrationList;
}

/** Read a single setting from the DB, returning the parsed value or the provided default. */
export function getSetting<T>(key: string, defaultValue: T): T {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Test-only handle. `runMigrations` is internal so the singleton can stay
 * the only public init path, but we expose it (and the migration list) for
 * unit tests that need to drive a synthetic Database without touching the
 * native better-sqlite3 module.
 */
export const __test__ = { runMigrations, getMigrations };
