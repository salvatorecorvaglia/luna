import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { AuthType } from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import log from '../lib/logger';

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
  created_at: number;
  updated_at: number;
}

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbDir = join(userDataPath, 'data');

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = join(dbDir, 'lunar.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check database integrity
  const integrityResult = db.pragma('integrity_check') as { integrity_check: string }[];
  if (integrityResult[0]?.integrity_check !== 'ok') {
    log.warn('[database] Integrity check failed:', integrityResult);
  }

  runMigrations(db);

  return db;
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

function getMigrations(): { name: string; sql: string }[] {
  return [
    {
      name: '001_connections',
      sql: `
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          host TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 22,
          username TEXT NOT NULL,
          auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key', 'key+passphrase')),
          private_key_path TEXT,
          folder TEXT NOT NULL DEFAULT 'default',
          color_tag TEXT,
          startup_command TEXT,
          last_connected_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `,
    },
    {
      name: '002_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('terminal.fontFamily', '"JetBrains Mono, Menlo, Consolas, monospace"'),
          ('terminal.fontSize', '14'),
          ('terminal.theme', '"dracula"'),
          ('terminal.scrollback', '10000'),
          ('transfer.concurrency', '3'),
          ('ssh.autoReconnect', 'true'),
          ('ssh.keepAliveInterval', '10000'),
          ('ssh.maxReconnectAttempts', '5');
      `,
    },
    {
      name: '003_history',
      sql: `
        CREATE TABLE IF NOT EXISTS connection_history (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
          connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
          disconnected_at INTEGER,
          duration_secs INTEGER,
          error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_history_connection ON connection_history(connection_id);
        CREATE INDEX IF NOT EXISTS idx_history_connected ON connection_history(connected_at DESC);
      `,
    },
    {
      name: '004_known_hosts_and_credentials',
      sql: `
        CREATE TABLE IF NOT EXISTS known_hosts (
          host_key TEXT PRIMARY KEY,
          algorithm TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          first_seen INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS credentials (
          connection_id TEXT PRIMARY KEY,
          encrypted_data BLOB NOT NULL
        );
      `,
    },
    {
      name: '005_ui_apply_terminal_theme',
      sql: `
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('ui.applyTerminalTheme', 'true');
      `,
    },
    {
      name: '006_remove_app_theme',
      sql: `DELETE FROM settings WHERE key = 'theme';`,
    },
    {
      name: '007_connection_indexes',
      sql: `
        CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);
        CREATE INDEX IF NOT EXISTS idx_connections_host ON connections(host);
        CREATE INDEX IF NOT EXISTS idx_connections_folder ON connections(folder);
      `,
    },
    {
      // Add provider columns and relax SSH-only NOT NULLs. SQLite doesn't
      // support ALTER COLUMN, so we rebuild the table: copy → drop → rename,
      // then recreate the indexes from migration 007.
      name: '008_provider_columns',
      sql: `
        CREATE TABLE connections_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'sftp' CHECK (provider IN ('sftp', 's3')),
          host TEXT,
          port INTEGER,
          username TEXT,
          auth_type TEXT CHECK (auth_type IN ('password', 'key', 'key+passphrase')),
          private_key_path TEXT,
          endpoint TEXT,
          region TEXT,
          default_bucket TEXT,
          force_path_style INTEGER,
          folder TEXT NOT NULL DEFAULT 'default',
          color_tag TEXT,
          startup_command TEXT,
          last_connected_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        INSERT INTO connections_new
          (id, name, provider, host, port, username, auth_type, private_key_path,
           folder, color_tag, startup_command, last_connected_at, created_at, updated_at)
        SELECT
          id, name, 'sftp', host, port, username, auth_type, private_key_path,
          folder, color_tag, startup_command, last_connected_at, created_at, updated_at
        FROM connections;

        DROP TABLE connections;
        ALTER TABLE connections_new RENAME TO connections;

        CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);
        CREATE INDEX IF NOT EXISTS idx_connections_host ON connections(host);
        CREATE INDEX IF NOT EXISTS idx_connections_folder ON connections(folder);
        CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider);
      `,
    },
    {
      name: '009_connection_sort_order',
      sql: `
        ALTER TABLE connections ADD COLUMN sort_order INTEGER DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_connections_sort_order ON connections(sort_order);
      `,
    },
    {
      // Jump host / bastion support. Single-hop: an SFTP connection can
      // reference another SFTP connection whose SSH session will be used to
      // open a forwarded TCP channel to the target. ON DELETE SET NULL keeps
      // dependent rows valid (they fall back to direct connect) when the
      // bastion row is deleted. SQLite enforces FK constraints only when
      // `PRAGMA foreign_keys = ON`, which getDatabase() sets at open time.
      name: '010_jump_host_connection_id',
      sql: `
        ALTER TABLE connections ADD COLUMN jump_host_connection_id TEXT
          REFERENCES connections(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_connections_jump_host
          ON connections(jump_host_connection_id);
      `,
    },
    {
      name: '011_manual_jump_host_columns',
      sql: `
        ALTER TABLE connections ADD COLUMN jump_host_host TEXT;
        ALTER TABLE connections ADD COLUMN jump_host_port INTEGER;
        ALTER TABLE connections ADD COLUMN jump_host_username TEXT;
        ALTER TABLE connections ADD COLUMN jump_host_auth_type TEXT
          CHECK (jump_host_auth_type IN ('password', 'key', 'key+passphrase'));
        ALTER TABLE connections ADD COLUMN jump_host_private_key_path TEXT;
      `,
    },
    {
      name: '012_connection_is_hidden',
      sql: `
        ALTER TABLE connections ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_connections_is_hidden ON connections(is_hidden);
      `,
    },
    {
      name: '013_cleanup_bogus_jump_hosts',
      sql: `
        -- Delete hidden jump host connections created by a bug in the MobaXterm importer 
        -- that misidentified UI color settings (e.g. "180,180,192") as hostnames.
        -- Due to ON DELETE SET NULL, the main connections will be automatically cleaned.
        DELETE FROM connections 
        WHERE is_hidden = 1 
          AND name LIKE 'Jump: %' 
          AND host LIKE '%,%';
      `,
    },
    {
      name: '014_cleanup_bogus_jump_hosts_v2',
      sql: `
        -- Delete hidden jump host connections created by a bug in the MobaXterm importer 
        -- that misidentified internal variables (e.g. "_Std_Colors_0_") as hostnames.
        DELETE FROM connections 
        WHERE is_hidden = 1 
          AND name LIKE 'Jump: %' 
          AND (host LIKE '%_%' OR host LIKE '%MobaFont%');
      `,
    },
  ];
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
