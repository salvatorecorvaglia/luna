import { beforeEach, describe, expect, it, vi } from 'vitest';

const statements: { sql: string; args: unknown[] }[] = [];
let failWrites = false;

vi.mock('../../../../src/main/services/database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (failWrites) throw new Error('disk I/O error');
        statements.push({ sql, args });
      },
    }),
  }),
}));
vi.mock('../../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordConnect,
  recordDisconnect,
} from '../../../../src/main/services/ssh/connection-history';

beforeEach(() => {
  statements.length = 0;
  failWrites = false;
});

describe('connection history', () => {
  it('opens a history row on connect and closes the same row on disconnect', () => {
    const id = recordConnect('conn-1');
    expect(id).toBeTypeOf('string');
    expect(statements.some((s) => s.sql.startsWith('INSERT INTO connection_history'))).toBe(true);

    recordDisconnect(id!);
    const update = statements.find((s) => s.sql.startsWith('UPDATE connection_history'));
    expect(update?.args.at(-1)).toBe(id);
  });

  it('prunes at most once per interval', () => {
    recordConnect('a');
    recordConnect('b');
    const prunes = statements.filter((s) => s.sql.includes('DELETE FROM connection_history'));
    expect(prunes.length).toBeLessThanOrEqual(1);
  });

  it('never throws — a failed write must not affect the connection', () => {
    failWrites = true;
    expect(recordConnect('conn-1')).toBeUndefined();
    expect(() => recordDisconnect('h1')).not.toThrow();
  });
});
