/**
 * Every persisted setting key, with the type stored under it.
 *
 * This interface is the single source of truth: `settings.ipc.ts` derives its
 * validation table from `AppSettings`, so a key that isn't listed here cannot
 * be written through `SETTINGS_SET`. Main-process tunables read via
 * `getSetting()` must therefore appear here too — several previously did not
 * (`ssh.connectTimeoutMs`, every `sftp.*` / `s3.*` key in `config/runtime.ts`),
 * which made them permanently pinned to their compile-time defaults despite
 * being documented as user-overridable.
 */
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
  /** Wraps the whole connect promise; distinct from the handshake-only readyTimeout. */
  'ssh.connectTimeoutMs': number;
  /**
   * Opt-in to binding local/dynamic port forwards to a non-loopback address.
   * Mirrors OpenSSH's `GatewayPorts`. Off by default: a forward on 0.0.0.0
   * republishes a remote service to every host on the local network.
   */
  'ssh.allowPublicPortForwardBind': boolean;
  'ssh.reconnectBaseDelayMs': number;
  'ssh.reconnectMaxDelayMs': number;
  'ui.applyTerminalTheme': boolean;
  // Main-process transport tunables — see src/main/config/runtime.ts for the
  // per-key safe ranges applied on read.
  'sftp.idleTimeoutMs': number;
  'sftp.idleCheckIntervalMs': number;
  'sftp.abortCleanupDelayMs': number;
  'sftp.transferChunkSizeBytes': number;
  'sftp.transferConcurrency': number;
  'sftp.transferHighWaterMarkBytes': number;
  's3.uploadQueueSize': number;
  's3.uploadPartSizeBytes': number;
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
  'ssh.connectTimeoutMs': 60000,
  'ssh.allowPublicPortForwardBind': false,
  'ssh.reconnectBaseDelayMs': 1000,
  'ssh.reconnectMaxDelayMs': 30000,
  'ui.applyTerminalTheme': true,
  'sftp.idleTimeoutMs': 5 * 60 * 1000,
  'sftp.idleCheckIntervalMs': 60 * 1000,
  'sftp.abortCleanupDelayMs': 50,
  'sftp.transferChunkSizeBytes': 256 * 1024,
  'sftp.transferConcurrency': 64,
  'sftp.transferHighWaterMarkBytes': 1024 * 1024,
  's3.uploadQueueSize': 4,
  's3.uploadPartSizeBytes': 5 * 1024 * 1024,
};
