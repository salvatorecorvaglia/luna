import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/luna-test' } }));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { __test__ } from '../../../src/main/services/database';

/**
 * database.test.ts drives runMigrations against a fake that never executes
 * SQL, because better-sqlite3 is rebuilt for Electron's ABI by `postinstall`
 * and cannot load under the Node test runner. That left every migration body —
 * the 008 table rebuild, the 018 fingerprint rewrite, the 019 ALTER — untested
 * against real data.
 *
 * Node's built-in `node:sqlite` is the same SQLite engine, so this file adapts
 * it to the subset of the better-sqlite3 surface runMigrations uses and runs
 * the real SQL, including upgrades from seeded older schemas.
 */

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
let DatabaseSync: (new (path: string) => SqliteDatabase) | null = null;
try {
  ({ DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  });
} catch {
  // node:sqlite is unflagged from Node 22.13; older runtimes skip this file.
}

type MigrationDb = Parameters<typeof __test__.runMigrations>[0];

/** Wrap a node:sqlite handle in the better-sqlite3 calls runMigrations makes. */
function adapt(raw: SqliteDatabase): MigrationDb {
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      (fn: (...a: unknown[]) => unknown) =>
      (...a: unknown[]) => {
        raw.exec('BEGIN');
        try {
          const result = fn(...a);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          raw.exec('ROLLBACK');
          throw err;
        }
      },
    pragma: (cmd: string) => {
      if (cmd.includes('=')) {
        raw.exec(`PRAGMA ${cmd}`);
        return undefined;
      }
      return raw.prepare(`PRAGMA ${cmd}`).all();
    },
  } as unknown as MigrationDb;
}

function openDb(): { raw: SqliteDatabase; db: MigrationDb } {
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  const raw = new DatabaseSync(':memory:');
  // Mirror getDatabase(): foreign keys are enforced for every migration.
  raw.exec('PRAGMA foreign_keys = ON');
  return { raw, db: adapt(raw) };
}

/** Apply migrations up to and including `lastName`, recording them as applied. */
function applyThrough(raw: SqliteDatabase, lastName: string): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  for (const m of __test__.getMigrations()) {
    raw.exec(m.sql);
    raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name);
    if (m.name === lastName) return;
  }
  throw new Error(`migration ${lastName} not found`);
}

function columns(raw: SqliteDatabase, table: string): string[] {
  return (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

describe.skipIf(!DatabaseSync)('database migrations (real SQLite)', () => {
  it('applies every migration to a fresh database and records each once', () => {
    const { raw, db } = openDb();
    __test__.runMigrations(db);

    const applied = (
      raw.prepare('SELECT name FROM _migrations ORDER BY id').all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(applied).toEqual(__test__.getMigrations().map((m) => m.name));

    // Re-running is a no-op rather than a duplicate-column failure.
    expect(() => __test__.runMigrations(db)).not.toThrow();
    raw.close();
  });

  it('produces a connections table with every column CONNECTION_COLUMNS selects', async () => {
    const { CONNECTION_COLUMNS } = await import('../../../src/main/services/database');
    const { raw, db } = openDb();
    __test__.runMigrations(db);
    const cols = columns(raw, 'connections');
    for (const c of CONNECTION_COLUMNS.split(', ')) {
      expect(cols).toContain(c);
    }
    raw.close();
  });

  it('008 preserves pre-existing SSH connections as provider sftp', () => {
    const { raw, db } = openDb();
    applyThrough(raw, '007_connection_indexes');
    raw
      .prepare(
        `INSERT INTO connections (id, name, host, port, username, auth_type, private_key_path, folder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('c1', 'prod', 'example.com', 2222, 'deploy', 'key', '~/.ssh/id_ed25519', 'work');

    __test__.runMigrations(db);

    const row = raw.prepare('SELECT * FROM connections WHERE id = ?').get('c1') as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      name: 'prod',
      provider: 'sftp',
      host: 'example.com',
      port: 2222,
      username: 'deploy',
      auth_type: 'key',
      private_key_path: '~/.ssh/id_ed25519',
      folder: 'work',
      is_hidden: 0,
      keepalive_count_max: 3,
    });
    raw.close();
  });

  it('008 relaxes SSH-only NOT NULLs so S3 rows can be stored', () => {
    const { raw, db } = openDb();
    __test__.runMigrations(db);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO connections (id, name, provider, endpoint, region, default_bucket)
           VALUES ('s1', 'bucket', 's3', 'https://s3.example.com', 'eu-west-1', 'b')`,
        )
        .run(),
    ).not.toThrow();
    raw.close();
  });

  it('018 strips base64 padding from stored host-key fingerprints', () => {
    const { raw, db } = openDb();
    applyThrough(raw, '017_snippets_and_workspaces');
    const insert = raw.prepare(
      'INSERT INTO known_hosts (host_key, algorithm, fingerprint) VALUES (?, ?, ?)',
    );
    insert.run('a:22', 'ssh-ed25519', 'SHA256:abcdef=');
    insert.run('b:22', 'ssh-ed25519', 'SHA256:already');

    __test__.runMigrations(db);

    const rows = raw
      .prepare('SELECT host_key, fingerprint FROM known_hosts ORDER BY host_key')
      .all() as { host_key: string; fingerprint: string }[];
    expect(rows).toEqual([
      { host_key: 'a:22', fingerprint: 'SHA256:abcdef' },
      { host_key: 'b:22', fingerprint: 'SHA256:already' },
    ]);
    raw.close();
  });

  it('019 marks existing credential blobs as the legacy (no-AAD) format', () => {
    const { raw, db } = openDb();
    applyThrough(raw, '018_unpadded_host_key_fingerprints');
    raw
      .prepare('INSERT INTO credentials (connection_id, encrypted_data) VALUES (?, ?)')
      .run('c1', Buffer.from([1, 2, 3]));

    __test__.runMigrations(db);

    const row = raw
      .prepare('SELECT aad_version, encrypted_data FROM credentials WHERE connection_id = ?')
      .get('c1') as { aad_version: number; encrypted_data: Uint8Array };
    expect(row.aad_version).toBe(0);
    expect(Buffer.from(row.encrypted_data)).toEqual(Buffer.from([1, 2, 3]));
    raw.close();
  });
});
