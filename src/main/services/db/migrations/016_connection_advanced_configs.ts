export default {
  name: '016_connection_advanced_configs',
  sql: `
    ALTER TABLE connections ADD COLUMN keepalive_interval INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE connections ADD COLUMN keepalive_count_max INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE connections ADD COLUMN port_forwards TEXT;
  `,
};
