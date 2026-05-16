export default {
  name: '003_history',
  sql: `
    CREATE TABLE IF NOT EXISTS connection_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
      disconnected_at INTEGER,
      duration_secs INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_history_connection ON connection_history(connection_id);
    CREATE INDEX IF NOT EXISTS idx_history_connected ON connection_history(connected_at DESC);
  `,
};
