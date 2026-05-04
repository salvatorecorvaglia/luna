export interface AppSettings {
  'terminal.fontFamily': string;
  'terminal.fontSize': number;
  'terminal.theme': string;
  'terminal.scrollback': number;
  'transfer.concurrency': number;
  'ssh.autoReconnect': boolean;
  'ssh.keepAliveInterval': number;
  'ssh.maxReconnectAttempts': number;
  'ssh.readyTimeout': number;
  'ui.applyTerminalTheme': boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  'terminal.fontFamily': 'JetBrains Mono, Menlo, Consolas, monospace',
  'terminal.fontSize': 14,
  'terminal.theme': 'dracula',
  'terminal.scrollback': 10000,
  'transfer.concurrency': 3,
  'ssh.autoReconnect': true,
  'ssh.keepAliveInterval': 10000,
  'ssh.maxReconnectAttempts': 5,
  'ssh.readyTimeout': 30000,
  'ui.applyTerminalTheme': true,
};
