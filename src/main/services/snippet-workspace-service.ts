import { ErrorCode, LunaError } from '@shared/errors';
import type { CreateSnippetInput, Snippet, UpdateSnippetInput } from '@shared/types/snippet';
import type { CreateWorkspaceInput, WorkspacePreset } from '@shared/types/workspace';
import { v4 as uuidv4 } from 'uuid';
import log from '../lib/logger';
import { getDatabase } from './database';

/**
 * Explicit projections, matching `CONNECTION_COLUMNS` in `database.ts`. These
 * queries used `SELECT *`, so a renamed column produced `undefined` fields at
 * the mapper instead of a SQL error at the call site.
 */
const SNIPPET_COLUMNS = 'id, title, command, tags, variables_json, created_at, updated_at';
const WORKSPACE_COLUMNS = 'id, name, layout_json, created_at, updated_at';

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

/**
 * Decode a JSON column defensively.
 *
 * These mappers used a bare `JSON.parse`, so one malformed row — from a
 * partial write, a hand-edited sqlite file, or a future schema change — threw
 * out of `listSnippets()` / `listWorkspaces()` and blanked the entire list,
 * leaving the user no way to reach the bad entry and delete it. Degrading to
 * the fallback is the same treatment `parsePortForwardsColumn` already gives
 * the `port_forwards` column in `connection-service.ts`.
 */
function parseJsonColumn<T>(raw: string | null, fallback: T, context: string): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    log.warn(`[Snippets] Ignoring malformed JSON in ${context}`);
    return fallback;
  }
}

function rowToSnippet(row: SnippetRow): Snippet {
  const tags = parseJsonColumn<Snippet['tags']>(row.tags, [], `snippet ${row.id} tags`);
  const variables = parseJsonColumn<Snippet['variables']>(
    row.variables_json,
    [],
    `snippet ${row.id} variables`,
  );
  return {
    id: row.id,
    title: row.title,
    command: row.command,
    // A column holding valid JSON of the wrong shape (an object, a string)
    // would otherwise reach the renderer and break `.map` at the call site.
    tags: Array.isArray(tags) ? tags : [],
    variables: Array.isArray(variables) ? variables : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkspace(row: WorkspaceRow): WorkspacePreset {
  return {
    id: row.id,
    name: row.name,
    // An empty preset is recoverable — the user can delete it. A throw here
    // took the whole preset list with it.
    layout: parseJsonColumn<WorkspacePreset['layout']>(
      row.layout_json,
      { connectionIds: [] },
      `workspace ${row.id} layout`,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SnippetWorkspaceService {
  // Snippets
  listSnippets(): Snippet[] {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT ${SNIPPET_COLUMNS} FROM snippets ORDER BY title ASC`)
      .all() as SnippetRow[];
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
    const existing = db
      .prepare(`SELECT ${SNIPPET_COLUMNS} FROM snippets WHERE id = ?`)
      .get(input.id) as SnippetRow | undefined;
    if (!existing) {
      // LunaError, not bare Error: `registerHandler` decays an unrecognised
      // throw to INTERNAL_ERROR, so the renderer could not tell "no such
      // snippet" from "the main process broke".
      throw new LunaError(`Snippet ${input.id} not found`, ErrorCode.NOT_FOUND);
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
      .prepare(`SELECT ${SNIPPET_COLUMNS} FROM snippets WHERE id = ?`)
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
    const rows = db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY name ASC`)
      .all() as WorkspaceRow[];
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
