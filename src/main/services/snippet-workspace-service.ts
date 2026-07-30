import type { CreateSnippetInput, Snippet, UpdateSnippetInput } from '@shared/types/snippet';
import type { CreateWorkspaceInput, WorkspacePreset } from '@shared/types/workspace';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';

interface SnippetRow {
  id: string;
  title: string;
  command: string;
  tags: string | null;
  variables_json: string | null;
  created_at: number;
  updated_at: number;
}

interface WorkspaceRow {
  id: string;
  name: string;
  layout_json: string;
  created_at: number;
  updated_at: number;
}

function rowToSnippet(row: SnippetRow): Snippet {
  return {
    id: row.id,
    title: row.title,
    command: row.command,
    tags: row.tags ? JSON.parse(row.tags) : [],
    variables: row.variables_json ? JSON.parse(row.variables_json) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkspace(row: WorkspaceRow): WorkspacePreset {
  return {
    id: row.id,
    name: row.name,
    layout: JSON.parse(row.layout_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SnippetWorkspaceService {
  // Snippets
  listSnippets(): Snippet[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM snippets ORDER BY title ASC').all() as SnippetRow[];
    return rows.map(rowToSnippet);
  }

  createSnippet(input: CreateSnippetInput): Snippet {
    const db = getDatabase();
    const now = Date.now();
    const snippet: Snippet = {
      id: uuidv4(),
      title: input.title,
      command: input.command,
      tags: input.tags || [],
      variables: input.variables || [],
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(`
      INSERT INTO snippets (id, title, command, tags, variables_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      snippet.id,
      snippet.title,
      snippet.command,
      JSON.stringify(snippet.tags),
      JSON.stringify(snippet.variables),
      snippet.createdAt,
      snippet.updatedAt,
    );

    return snippet;
  }

  updateSnippet(input: UpdateSnippetInput): Snippet {
    const db = getDatabase();
    const now = Date.now();
    const existing = db.prepare('SELECT * FROM snippets WHERE id = ?').get(input.id) as
      | SnippetRow
      | undefined;
    if (!existing) {
      throw new Error(`Snippet ${input.id} not found`);
    }

    const title = input.title ?? existing.title;
    const command = input.command ?? existing.command;
    const tags = input.tags !== undefined ? JSON.stringify(input.tags) : existing.tags;
    const variables =
      input.variables !== undefined ? JSON.stringify(input.variables) : existing.variables_json;

    db.prepare(`
      UPDATE snippets
      SET title = ?, command = ?, tags = ?, variables_json = ?, updated_at = ?
      WHERE id = ?
    `).run(title, command, tags, variables, now, input.id);

    const updatedRow = db
      .prepare('SELECT * FROM snippets WHERE id = ?')
      .get(input.id) as SnippetRow;
    return rowToSnippet(updatedRow);
  }

  deleteSnippet(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
  }

  // Workspaces
  listWorkspaces(): WorkspacePreset[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM workspaces ORDER BY name ASC').all() as WorkspaceRow[];
    return rows.map(rowToWorkspace);
  }

  createWorkspace(input: CreateWorkspaceInput): WorkspacePreset {
    const db = getDatabase();
    const now = Date.now();
    const preset: WorkspacePreset = {
      id: uuidv4(),
      name: input.name,
      layout: input.layout,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(`
      INSERT INTO workspaces (id, name, layout_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      preset.id,
      preset.name,
      JSON.stringify(preset.layout),
      preset.createdAt,
      preset.updatedAt,
    );

    return preset;
  }

  deleteWorkspace(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }
}

export const snippetWorkspaceService = new SnippetWorkspaceService();
