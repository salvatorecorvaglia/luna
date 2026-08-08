import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These mappers used a bare `JSON.parse` on the `tags`, `variables_json` and
 * `layout_json` columns. One malformed row — a partial write, a hand-edited
 * sqlite file, a future schema change — threw out of `listSnippets()` /
 * `listWorkspaces()` and blanked the entire list, leaving the user no way to
 * reach the bad entry and delete it. Every other service in the app degrades
 * gracefully here (see `parsePortForwardsColumn`); this one did not.
 */

let snippetRows: Record<string, unknown>[] = [];
let workspaceRows: Record<string, unknown>[] = [];
let singleSnippet: Record<string, unknown> | undefined;

const fakeDb = {
  prepare(sql: string) {
    return {
      run: () => ({ changes: 1 }),
      get: () => singleSnippet,
      all: () => (sql.includes('FROM snippets') ? snippetRows : workspaceRows),
    };
  },
  transaction: (fn: () => void) => () => fn(),
};

vi.mock('../database', () => ({ getDatabase: () => fakeDb }));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SnippetWorkspaceService } from '../snippet-workspace-service';

const service = new SnippetWorkspaceService();

function snippetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    title: 'Tail logs',
    command: 'tail -f /var/log/syslog',
    tags: '["ops"]',
    variables_json: '["host"]',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

beforeEach(() => {
  snippetRows = [];
  workspaceRows = [];
  singleSnippet = undefined;
});

describe('listSnippets resilience', () => {
  it('maps a well-formed row', () => {
    snippetRows = [snippetRow()];
    expect(service.listSnippets()[0]).toMatchObject({
      id: 's1',
      title: 'Tail logs',
      tags: ['ops'],
      variables: ['host'],
    });
  });

  it('degrades to empty arrays when tags JSON is malformed', () => {
    snippetRows = [snippetRow({ tags: '{not json' })];
    expect(() => service.listSnippets()).not.toThrow();
    expect(service.listSnippets()[0].tags).toEqual([]);
  });

  it('degrades when variables JSON is malformed', () => {
    snippetRows = [snippetRow({ variables_json: '[[[' })];
    expect(service.listSnippets()[0].variables).toEqual([]);
  });

  it('coerces valid JSON of the wrong shape to an empty array', () => {
    // Parseable but not an array — this would reach the renderer and break
    // `.map` at the call site.
    snippetRows = [snippetRow({ tags: '{"ops":true}' })];
    expect(service.listSnippets()[0].tags).toEqual([]);
  });

  it('does not let one bad row hide the good ones', () => {
    // The whole point: a single corrupt entry used to blank the entire vault.
    snippetRows = [
      snippetRow({ id: 'good-1' }),
      snippetRow({ id: 'bad', tags: 'null bytes and nonsense' }),
      snippetRow({ id: 'good-2' }),
    ];
    const listed = service.listSnippets();
    expect(listed).toHaveLength(3);
    expect(listed.map((s) => s.id)).toEqual(['good-1', 'bad', 'good-2']);
  });

  it('treats a null tags column as no tags', () => {
    snippetRows = [snippetRow({ tags: null, variables_json: null })];
    expect(service.listSnippets()[0]).toMatchObject({ tags: [], variables: [] });
  });
});

describe('listWorkspaces resilience', () => {
  it('maps a well-formed row', () => {
    workspaceRows = [
      {
        id: 'w1',
        name: 'Prod',
        layout_json: '{"connectionIds":["a"]}',
        created_at: 1,
        updated_at: 1,
      },
    ];
    expect(service.listWorkspaces()[0].layout).toEqual({ connectionIds: ['a'] });
  });

  it('degrades to an empty layout when layout JSON is malformed', () => {
    workspaceRows = [
      { id: 'w1', name: 'Prod', layout_json: 'not json', created_at: 1, updated_at: 1 },
    ];
    expect(() => service.listWorkspaces()).not.toThrow();
    expect(service.listWorkspaces()[0].layout).toEqual({ connectionIds: [] });
  });
});

describe('updateSnippet', () => {
  it('throws a structured NOT_FOUND rather than a bare Error', () => {
    // A bare `Error` decays to INTERNAL_ERROR crossing the IPC bridge, so the
    // renderer could not distinguish "no such snippet" from "main broke".
    singleSnippet = undefined;
    try {
      service.updateSnippet({ id: 'missing' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('NOT_FOUND');
    }
  });

  it('preserves untouched fields', () => {
    singleSnippet = snippetRow();
    const updated = service.updateSnippet({ id: 's1', title: 'Renamed' });
    // `get` returns the same stub both times, so this asserts the mapper is
    // wired up rather than the SQL — enough to catch a mapping regression.
    expect(updated.command).toBe('tail -f /var/log/syslog');
  });
});
