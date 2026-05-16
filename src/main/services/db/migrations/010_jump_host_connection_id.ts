/**
 * Jump host / bastion support. Single-hop: an SFTP connection can reference
 * another SFTP connection whose SSH session will be used to open a forwarded
 * TCP channel to the target. ON DELETE SET NULL keeps dependent rows valid
 * (they fall back to direct connect) when the bastion row is deleted. SQLite
 * enforces FK constraints only when `PRAGMA foreign_keys = ON`, which
 * getDatabase() sets at open time.
 */
export default {
  name: '010_jump_host_connection_id',
  sql: `
    ALTER TABLE connections ADD COLUMN jump_host_connection_id TEXT
      REFERENCES connections(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_connections_jump_host
      ON connections(jump_host_connection_id);
  `,
};
