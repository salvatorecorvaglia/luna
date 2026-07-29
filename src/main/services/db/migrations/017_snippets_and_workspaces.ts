export default {
  name: '017_snippets_and_workspaces',
  sql: `
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      command TEXT NOT NULL,
      tags TEXT,
      variables_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snippets_title ON snippets(title);
    CREATE INDEX IF NOT EXISTS idx_workspaces_name ON workspaces(name);
  `,
};
