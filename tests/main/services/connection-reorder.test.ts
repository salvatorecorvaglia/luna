import { describe, expect, it, vi } from 'vitest';

let current: string[] = [];
const writes: [number, string][] = [];

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) =>
      sql.startsWith('SELECT id FROM connections')
        ? { all: () => current.map((id) => ({ id })) }
        : { run: (order: number, id: string) => writes.push([order, id]) },
    transaction: (fn: () => void) => () => fn(),
  }),
  CONNECTION_COLUMNS: 'id',
}));
vi.mock('../../../src/main/services/credential-store', () => ({}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

import { connectionService } from '../../../src/main/services/connection-service';

function reorder(visibleNewOrder: string[]): string[] {
  writes.length = 0;
  connectionService.reorderConnections(visibleNewOrder);
  return writes.sort((a, b) => a[0] - b[0]).map(([, id]) => id);
}

describe('reorderConnections', () => {
  it('keeps filtered-out connections in place when only a visible subset is reordered', () => {
    // Regression: the visible subset was renumbered from 0, colliding with
    // the sort_order of hidden/filtered rows, which then jumped position.
    current = ['a', 'hidden1', 'b', 'hidden2', 'c'];
    expect(reorder(['c', 'a', 'b'])).toEqual(['c', 'hidden1', 'a', 'hidden2', 'b']);
  });

  it('assigns every connection a distinct position', () => {
    current = ['a', 'b', 'c'];
    reorder(['b', 'a', 'c']);
    expect(writes.map(([o]) => o).sort()).toEqual([0, 1, 2]);
  });

  it('ignores ids that no longer exist', () => {
    current = ['a', 'b'];
    expect(reorder(['ghost', 'b', 'a'])).toEqual(['b', 'a']);
  });
});
