import { IPC } from '@shared/constants';
import { registerHandler } from '../lib/ipc-handler';
import { assertNonEmptyString } from '../lib/validate';
import { snippetWorkspaceService } from '../services/snippet-workspace-service';
import type { CreateSnippetInput, UpdateSnippetInput } from '@shared/types/snippet';
import type { CreateWorkspaceInput } from '@shared/types/workspace';

export function registerSnippetWorkspaceHandlers(): void {
  // Snippets
  registerHandler(IPC.SNIPPET_LIST, () => {
    return snippetWorkspaceService.listSnippets();
  });

  registerHandler(IPC.SNIPPET_CREATE, (_event, input: CreateSnippetInput) => {
    assertNonEmptyString(input.title, 'title');
    assertNonEmptyString(input.command, 'command');
    return snippetWorkspaceService.createSnippet(input);
  });

  registerHandler(IPC.SNIPPET_UPDATE, (_event, input: UpdateSnippetInput) => {
    assertNonEmptyString(input.id, 'id');
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
    assertNonEmptyString(input.name, 'name');
    return snippetWorkspaceService.createWorkspace(input);
  });

  registerHandler(IPC.WORKSPACE_DELETE, (_event, id: string) => {
    assertNonEmptyString(id, 'id');
    snippetWorkspaceService.deleteWorkspace(id);
  });
}
