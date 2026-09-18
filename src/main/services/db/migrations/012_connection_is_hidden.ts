export default {
  name: '012_connection_is_hidden',
  sql: `
    ALTER TABLE connections ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_connections_is_hidden ON connections(is_hidden);
  `,
};
