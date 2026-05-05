import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { AuthType } from '@shared/types/connection';
import log from '../lib/logger';

/** Shape of a row in the `connections` table (snake_case DB columns). */
export interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  private_key_path: string | null;
  folder: string;
  color_tag: string | null;
  startup_command: string | null;
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
