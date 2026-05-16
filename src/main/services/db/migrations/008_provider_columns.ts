/**
 * Add provider columns and relax SSH-only NOT NULLs. SQLite doesn't support
 * ALTER COLUMN, so we rebuild the table: copy → drop → rename, then recreate
 * the indexes from migration 007.
 */
export default {
  name: '008_provider_columns',
  sql: `
    CREATE TABLE connections_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'sftp' CHECK (provider IN ('sftp', 's3')),
      host TEXT,
      port INTEGER,
      username TEXT,
      auth_type TEXT CHECK (auth_type IN ('password', 'key', 'key+passphrase')),
      private_key_path TEXT,
      endpoint TEXT,
      region TEXT,
      default_bucket TEXT,
      force_path_style INTEGER,
      folder TEXT NOT NULL DEFAULT 'default',
      color_tag TEXT,
      startup_command TEXT,
      last_connected_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    INSERT INTO connections_new
      (id, name, provider, host, port, username, auth_type, private_key_path,
       folder, color_tag, startup_command, last_connected_at, created_at, updated_at)
    SELECT
      id, name, 'sftp', host, port, username, auth_type, private_key_path,
      folder, color_tag, startup_command, last_connected_at, created_at, updated_at
    FROM connections;

    DROP TABLE connections;
    ALTER TABLE connections_new RENAME TO connections;

    CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);
    CREATE INDEX IF NOT EXISTS idx_connections_host ON connections(host);
    CREATE INDEX IF NOT EXISTS idx_connections_folder ON connections(folder);
    CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider);
  `,
};
