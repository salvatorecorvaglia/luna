import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/luna-test' } }));
vi.mock('../../lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { __test__, MigrationError } from '../database';

/**
 * Build the smallest fake that satisfies the runMigrations call surface:
 * `db.exec(sql)`, `db.prepare(sql).all() / .run() / .get()`, and
 * `db.transaction(fn)(...)`.
 */
function makeFakeDb(opts: { failOn?: string } = {}): {
  exec: (sql: string) => void;
  prepare: (sql: string) => { all: () => unknown[]; run: () => void; get: () => unknown };
  transaction: <T extends (...a: unknown[]) => unknown>(fn: T) => (...a: Parameters<T>) => unknown;
  pragma: (cmd: string) => unknown;
  applied: string[];
  log: string[];
} {
  const applied: string[] = [];
  const log: string[] = [];
  return {
    applied,
    log,
    exec(sql: string): void {
      log.push(`exec ${sql.slice(0, 32)}`);
      if (opts.failOn && sql.includes(opts.failOn)) {
        throw new Error(`syntax error near "${opts.failOn}"`);
      }
    },
    prepare(sql: string) {
      return {
        all: (): unknown[] => applied.map((name) => ({ name })),
        run: (name?: string): void => {
          if (sql.startsWith('INSERT INTO _migrations') && name) applied.push(name);
        },
        get: (): unknown => undefined,
      };
    },
    transaction<T extends (...a: unknown[]) => unknown>(fn: T) {
      return (...a: Parameters<T>) => fn(...a);
    },
    pragma(cmd: string): unknown {
      // Used by runMigrations' post-apply integrity_check; return the
      // happy-path shape better-sqlite3 produces ([{ integrity_check: 'ok' }]).
      if (cmd === 'integrity_check') return [{ integrity_check: 'ok' }];
      return undefined;
    },
  };
}

describe('database migrations', () => {
  it('applies all migrations successfully on a fresh DB', () => {
    const db = makeFakeDb();
    expect(() =>
      __test__.runMigrations(db as unknown as Parameters<typeof __test__.runMigrations>[0]),
    ).not.toThrow();
    // Should have recorded every migration name from getMigrations().
    expect(db.applied).toEqual(__test__.getMigrations().map((m) => m.name));
  });

  it('is idempotent — re-running with already-applied migrations is a no-op', () => {
    const db = makeFakeDb();
    // Pre-seed `applied` so `prepare(...).all()` reports them as done.
    db.applied.push(...__test__.getMigrations().map((m) => m.name));
    expect(() =>
      __test__.runMigrations(db as unknown as Parameters<typeof __test__.runMigrations>[0]),
    ).not.toThrow();
    // No new entries beyond the seed.
    expect(db.applied).toHaveLength(__test__.getMigrations().length);
  });

  it('includes the provider-columns migration', () => {
    const names = __test__.getMigrations().map((m) => m.name);
    expect(names).toContain('008_provider_columns');
    const m = __test__.getMigrations().find((x) => x.name === '008_provider_columns');
    expect(m?.sql).toMatch(/provider TEXT NOT NULL DEFAULT 'sftp'/);
    expect(m?.sql).toMatch(/default_bucket/);
    // The migration must rebuild the table and copy existing rows so SFTP
    // connections survive the schema change.
    expect(m?.sql).toMatch(/INSERT INTO connections_new/);
    expect(m?.sql).toMatch(/DROP TABLE connections/);
  });

  it('throws MigrationError if integrity_check fails after a migration', () => {
    const db = makeFakeDb();
    // Override pragma to report corruption so the post-apply check trips.
    db.pragma = (cmd: string) =>
      cmd === 'integrity_check' ? [{ integrity_check: '*** in database main ***' }] : undefined;
    const run = (): void =>
      __test__.runMigrations(db as unknown as Parameters<typeof __test__.runMigrations>[0]);
    expect(run).toThrow(MigrationError);
  });

  it('throws MigrationError naming the offending migration on SQL failure', () => {
    // Force exec() to throw on a fingerprint that only appears in 002_settings.
    const db = makeFakeDb({ failOn: 'CREATE TABLE IF NOT EXISTS settings' });
    const run = (): void =>
      __test__.runMigrations(db as unknown as Parameters<typeof __test__.runMigrations>[0]);
    expect(run).toThrow(MigrationError);
    try {
      run();
    } catch (err) {
      const e = err as MigrationError;
      expect(e.migrationName).toBe('002_settings');
      expect(e.message).toContain('002_settings');
      expect(e.cause).toBeInstanceOf(Error);
    }
  });
});

describe('MigrationError', () => {
  it('preserves the cause and exposes the migration name', () => {
    const cause = new Error('SQL boom');
    const err = new MigrationError('007_connection_indexes', cause);
    expect(err.name).toBe('MigrationError');
    expect(err.migrationName).toBe('007_connection_indexes');
    expect(err.cause).toBe(cause);
    expect(err.message).toMatch(/007_connection_indexes/);
    expect(err.message).toMatch(/SQL boom/);
  });
});
