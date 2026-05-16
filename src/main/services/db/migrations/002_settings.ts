export default {
  name: '002_settings',
  sql: `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('terminal.fontFamily', '"JetBrains Mono, Menlo, Consolas, monospace"'),
      ('terminal.fontSize', '14'),
      ('terminal.theme', '"dracula"'),
      ('terminal.scrollback', '10000'),
      ('transfer.concurrency', '3'),
      ('ssh.autoReconnect', 'true'),
      ('ssh.keepAliveInterval', '10000'),
      ('ssh.maxReconnectAttempts', '5');
  `,
};
