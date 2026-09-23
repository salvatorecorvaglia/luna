export default {
  name: '007_connection_indexes',
  sql: `
    CREATE INDEX IF NOT EXISTS idx_connections_name ON connections(name);
    CREATE INDEX IF NOT EXISTS idx_connections_host ON connections(host);
    CREATE INDEX IF NOT EXISTS idx_connections_folder ON connections(folder);
  `,
};
