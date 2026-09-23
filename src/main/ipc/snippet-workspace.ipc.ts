import { IPC } from '@shared/constants';
import type { CreateSnippetInput, UpdateSnippetInput } from '@shared/types/snippet';
import type { CreateWorkspaceInput } from '@shared/types/workspace';
import { registerHandler } from '../lib/ipc-handler';
import { assertNonEmptyString, validationError } from '../lib/validate';
import { snippetWorkspaceService } from '../services/snippet-workspace-service';

/**
 * Bounds on the free-text fields. Every other write path in the app caps its
 * columns (see `connection-service.ts`); these handlers checked only that two
 * fields were non-empty strings, so a pasted blob became a snippet title in
 * the vault list and an arbitrarily long array of tags went to disk unbounded.
 * The global 4 MiB IPC cap was the only real limit.
 */
const MAX_TITLE_LEN = 200;
const MAX_COMMAND_LEN = 16_384;
const MAX_TAG_LEN = 64;
const MAX_TAGS = 32;
const MAX_VARIABLES = 32;
const MAX_CONNECTION_IDS = 64;

function assertBoundedText(value: unknown, name: string, max: number): asserts value is string {
  assertNonEmptyString(value, name);
  if (value.length > max) {
    throw validationError(`${name} must be at most ${max} characters`);
  }
}

/** Validate an optional string array (tags, variables) element-by-element. */
function assertOptionalStringArray(
  value: unknown,
  name: string,
  maxItems: number,
  maxItemLen: number,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw validationError(`${name} must be an array`);
  if (value.length > maxItems) {
    throw validationError(`${name} must contain at most ${maxItems} entries`);
  }
  for (const entry of value) {
    assertBoundedText(entry, `${name} entry`, maxItemLen);
  }
}

export function registerSnippetWorkspaceHandlers(): void {
  // Snippets
  registerHandler(IPC.SNIPPET_LIST, () => {
    return snippetWorkspaceService.listSnippets();
  });

  registerHandler(IPC.SNIPPET_CREATE, (_event, input: CreateSnippetInput) => {
    assertBoundedText(input.title, 'title', MAX_TITLE_LEN);
    assertBoundedText(input.command, 'command', MAX_COMMAND_LEN);
    assertOptionalStringArray(input.tags, 'tags', MAX_TAGS, MAX_TAG_LEN);
    assertOptionalStringArray(input.variables, 'variables', MAX_VARIABLES, MAX_TAG_LEN);
    return snippetWorkspaceService.createSnippet(input);
  });

  registerHandler(IPC.SNIPPET_UPDATE, (_event, input: UpdateSnippetInput) => {
    assertNonEmptyString(input.id, 'id');
    // Update is partial — only check the fields actually supplied, but hold
    // them to the same bounds create enforces.
    if (input.title !== undefined) assertBoundedText(input.title, 'title', MAX_TITLE_LEN);
    if (input.command !== undefined) assertBoundedText(input.command, 'command', MAX_COMMAND_LEN);
    assertOptionalStringArray(input.tags, 'tags', MAX_TAGS, MAX_TAG_LEN);
    assertOptionalStringArray(input.variables, 'variables', MAX_VARIABLES, MAX_TAG_LEN);
    return snippetWorkspaceService.updateSnippet(input);
  });

  registerHandler(IPC.SNIPPET_DELETE, (_event, id: string) => {
    assertNonEmptyString(id, 'id');
    snippetWorkspaceService.deleteSnippet(id);
  });

  // Workspaces
  registerHandler(IPC.WORKSPACE_LIST, () => {
    return snippetWorkspaceService.listWorkspaces();
  });

  registerHandler(IPC.WORKSPACE_CREATE, (_event, input: CreateWorkspaceInput) => {
    assertBoundedText(input.name, 'name', MAX_TITLE_LEN);
    // `layout` is serialised straight into `layout_json` and read back on
    // every preset list, so its shape has to be checked here — nothing
    // downstream does it.
    const layout = input.layout;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      throw validationError('layout must be an object');
    }
    if (!Array.isArray(layout.connectionIds)) {
      throw validationError('layout.connectionIds must be an array');
    }
    if (layout.connectionIds.length > MAX_CONNECTION_IDS) {
      throw validationError(
        `layout.connectionIds must contain at most ${MAX_CONNECTION_IDS} entries`,
      );
    }
    for (const id of layout.connectionIds) {
      assertBoundedText(id, 'layout.connectionIds entry', MAX_TITLE_LEN);
    }
    if (
      layout.splitDirection !== undefined &&
      layout.splitDirection !== 'horizontal' &&
      layout.splitDirection !== 'vertical'
    ) {
      throw validationError('layout.splitDirection must be "horizontal" or "vertical"');
    }
    if (layout.activeTabId !== undefined) {
      assertBoundedText(layout.activeTabId, 'layout.activeTabId', MAX_TITLE_LEN);
    }
    return snippetWorkspaceService.createWorkspace(input);
  });

  registerHandler(IPC.WORKSPACE_DELETE, (_event, id: string) => {
    assertNonEmptyString(id, 'id');
    snippetWorkspaceService.deleteWorkspace(id);
  });
}
