export default {
  name: '001_connections',
  sql: `
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK (auth_type IN ('password', 'key', 'key+passphrase')),
      private_key_path TEXT,
      folder TEXT NOT NULL DEFAULT 'default',
      color_tag TEXT,
      startup_command TEXT,
      last_connected_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `,
};
