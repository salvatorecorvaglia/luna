export default {
  name: '004_known_hosts_and_credentials',
  sql: `
    CREATE TABLE IF NOT EXISTS known_hosts (
      host_key TEXT PRIMARY KEY,
      algorithm TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      first_seen INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS credentials (
      connection_id TEXT PRIMARY KEY,
      encrypted_data BLOB NOT NULL
    );
  `,
};
