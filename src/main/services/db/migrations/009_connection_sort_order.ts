export default {
  name: '009_connection_sort_order',
  sql: `
    ALTER TABLE connections ADD COLUMN sort_order INTEGER DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_connections_sort_order ON connections(sort_order);
  `,
};
