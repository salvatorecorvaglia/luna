import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These handlers were the one write surface in the app with essentially no
 * input validation — two `assertNonEmptyString` calls and nothing else. Every
 * other service caps its free-text columns and checks array shapes; here a
 * pasted blob became a snippet title, an unbounded tag array went to disk, and
 * `layout` was serialised into `layout_json` entirely unchecked. The global
 * 4 MiB IPC payload cap was the only real limit.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

const createSnippet = vi.fn((input: unknown) => input);
const updateSnippet = vi.fn((input: unknown) => input);
const createWorkspace = vi.fn((input: unknown) => input);

vi.mock('../../services/snippet-workspace-service', () => ({
  snippetWorkspaceService: {
    listSnippets: vi.fn(() => []),
    createSnippet: (i: unknown) => createSnippet(i),
    updateSnippet: (i: unknown) => updateSnippet(i),
    deleteSnippet: vi.fn(),
    listWorkspaces: vi.fn(() => []),
    createWorkspace: (i: unknown) => createWorkspace(i),
    deleteWorkspace: vi.fn(),
  },
}));

import { registerSnippetWorkspaceHandlers } from '../snippet-workspace.ipc';

const validSnippet = { title: 'Tail logs', command: 'tail -f /var/log/syslog' };
const validLayout = { connectionIds: ['a'] };

beforeEach(() => {
  handlers.clear();
  createSnippet.mockClear();
  updateSnippet.mockClear();
  createWorkspace.mockClear();
  registerSnippetWorkspaceHandlers();
});

describe('SNIPPET_CREATE validation', () => {
  it('accepts a well-formed snippet', async () => {
    await expect(
      handlers.get(IPC.SNIPPET_CREATE)!({}, { ...validSnippet, tags: ['ops'] }),
    ).resolves.toBeTruthy();
    expect(createSnippet).toHaveBeenCalled();
  });

  it.each([
    ['an empty title', { ...validSnippet, title: '  ' }],
    ['an over-long title', { ...validSnippet, title: 'x'.repeat(201) }],
    ['an empty command', { ...validSnippet, command: '' }],
    ['an over-long command', { ...validSnippet, command: 'x'.repeat(16_385) }],
    ['a null byte in the title', { ...validSnippet, title: 'ti\0tle' }],
    ['tags that are not an array', { ...validSnippet, tags: 'ops' }],
    ['too many tags', { ...validSnippet, tags: Array(33).fill('t') }],
    ['an over-long tag', { ...validSnippet, tags: ['x'.repeat(65)] }],
    ['a non-string tag', { ...validSnippet, tags: [42] }],
    ['too many variables', { ...validSnippet, variables: Array(33).fill('v') }],
  ])('rejects %s', async (_label, input) => {
    await expect(handlers.get(IPC.SNIPPET_CREATE)!({}, input)).rejects.toThrow();
    expect(createSnippet).not.toHaveBeenCalled();
  });
});

describe('SNIPPET_UPDATE validation', () => {
  it('accepts a partial update that omits every optional field', async () => {
    await expect(handlers.get(IPC.SNIPPET_UPDATE)!({}, { id: 's1' })).resolves.toBeTruthy();
  });

  it('holds a supplied title to the same cap as create', async () => {
    await expect(
      handlers.get(IPC.SNIPPET_UPDATE)!({}, { id: 's1', title: 'x'.repeat(201) }),
    ).rejects.toThrow(/at most/);
    expect(updateSnippet).not.toHaveBeenCalled();
  });

  it('rejects an empty id', async () => {
    await expect(handlers.get(IPC.SNIPPET_UPDATE)!({}, { id: '' })).rejects.toThrow(/id/);
  });
});

describe('WORKSPACE_CREATE validation', () => {
  it('accepts a well-formed preset', async () => {
    await expect(
      handlers.get(IPC.WORKSPACE_CREATE)!({}, { name: 'Prod', layout: validLayout }),
    ).resolves.toBeTruthy();
  });

  it.each([
    ['a missing layout', { name: 'Prod' }],
    ['a layout that is an array', { name: 'Prod', layout: [] }],
    ['a layout with no connectionIds array', { name: 'Prod', layout: {} }],
    ['a non-string connection id', { name: 'Prod', layout: { connectionIds: [1] } }],
    ['too many connection ids', { name: 'Prod', layout: { connectionIds: Array(65).fill('a') } }],
    [
      'an unknown splitDirection',
      { name: 'Prod', layout: { ...validLayout, splitDirection: 'diagonal' } },
    ],
    ['an over-long name', { name: 'x'.repeat(201), layout: validLayout }],
  ])('rejects %s', async (_label, input) => {
    await expect(handlers.get(IPC.WORKSPACE_CREATE)!({}, input)).rejects.toThrow();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('accepts the optional layout fields when well-formed', async () => {
    await expect(
      handlers.get(IPC.WORKSPACE_CREATE)!(
        {},
        {
          name: 'Prod',
          layout: { connectionIds: ['a'], splitDirection: 'vertical', activeTabId: 't1' },
        },
      ),
    ).resolves.toBeTruthy();
  });
});

describe('delete handlers', () => {
  it('reject an empty id', async () => {
    await expect(handlers.get(IPC.SNIPPET_DELETE)!({}, '')).rejects.toThrow(/id/);
    await expect(handlers.get(IPC.WORKSPACE_DELETE)!({}, '')).rejects.toThrow(/id/);
  });
});
