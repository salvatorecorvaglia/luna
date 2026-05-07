export const IPC = {
  // Connections
  CONNECTION_LIST: 'connection:list',
  CONNECTION_GET: 'connection:get',
  CONNECTION_CREATE: 'connection:create',
  CONNECTION_UPDATE: 'connection:update',
  CONNECTION_DELETE: 'connection:delete',
  CONNECTION_EXPORT: 'connection:export',
  CONNECTION_IMPORT: 'connection:import',
  CONNECTION_IMPORT_FROM_FILE: 'connection:import-from-file',

  // SSH
  SSH_CONNECT: 'ssh:connect',
  SSH_DISCONNECT: 'ssh:disconnect',
  SSH_SEND_DATA: 'ssh:send-data',
  SSH_RESIZE: 'ssh:resize',

  // SSH Events (main -> renderer)
  SSH_ON_DATA: 'ssh:on-data',
  SSH_ON_CLOSE: 'ssh:on-close',
  SSH_ON_ERROR: 'ssh:on-error',
  SSH_ON_STATUS: 'ssh:on-status',
  SSH_ON_HOST_KEY_CHANGE: 'ssh:on-host-key-change',
  SSH_TRUST_HOST_KEY: 'ssh:trust-host-key',

  // SFTP
  SFTP_LIST: 'sftp:list',
  SFTP_STAT: 'sftp:stat',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_RENAME: 'sftp:rename',
  SFTP_DELETE: 'sftp:delete',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_READ_FILE: 'sftp:read-file',

  // Storage (provider-agnostic — works for both SFTP and S3 sessions via the registry)
  STORAGE_LIST: 'storage:list',
  STORAGE_STAT: 'storage:stat',
  STORAGE_MKDIR: 'storage:mkdir',
  STORAGE_RENAME: 'storage:rename',
  STORAGE_DELETE: 'storage:delete',
  STORAGE_READ_FILE: 'storage:read-file',
  STORAGE_DOWNLOAD: 'storage:download',
  STORAGE_UPLOAD: 'storage:upload',

  // S3
  S3_CONNECT: 's3:connect',
  S3_DISCONNECT: 's3:disconnect',
  S3_TEST_CONNECTION: 's3:test-connection',

  // Local filesystem
  SHELL_READDIR: 'shell:readdir',
  SHELL_HOME_DIR: 'shell:home-dir',
  SHELL_OPEN_FILE_DIALOG: 'shell:open-file-dialog',
  SHELL_JOIN_PATH: 'shell:join-path',
  SHELL_SAVE_FILE_DIALOG: 'shell:save-file-dialog',
  SHELL_CHECK_FILE: 'shell:check-file',
  SHELL_READ_FILE: 'shell:read-file',

  // Transfers (main -> renderer)
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_COMPLETE: 'transfer:complete',
  TRANSFER_ERROR: 'transfer:error',
  TRANSFER_CANCEL: 'transfer:cancel',
  TRANSFER_CANCEL_BY_SESSION: 'transfer:cancel-by-session',

  // Credentials
  CREDENTIAL_STORE: 'credential:store',
  CREDENTIAL_RETRIEVE: 'credential:retrieve',
  CREDENTIAL_DELETE: 'credential:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',

  // App
  APP_CHECK_UPDATE: 'app:check-update',
  APP_INSTALL_UPDATE: 'app:install-update',
  APP_GET_VERSION: 'app:get-version',
  APP_GET_LOG_PATH: 'app:get-log-path',
  APP_OPEN_LOG_FILE: 'app:open-log-file',
  APP_GET_ACTIVE_SESSIONS: 'app:get-active-sessions',
  APP_GET_CREDENTIAL_BACKEND: 'app:get-credential-backend',

  // App update events (main -> renderer)
  APP_UPDATE_AVAILABLE: 'app:update-available',
  APP_UPDATE_DOWNLOAD_PROGRESS: 'app:update-download-progress',
  APP_UPDATE_DOWNLOADED: 'app:update-downloaded',
  APP_UPDATE_ERROR: 'app:update-error',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // Transfers (additional)
  TRANSFER_CANCELLED: 'transfer:cancelled',

  // SSH (additional)
  SSH_TEST_CONNECTION: 'ssh:test-connection',
} as const;

/** Resource limits — centralised so renderer + main agree. */
export const LIMITS = {
  /** Maximum file preview size (bytes). Larger files are refused at the storage layer (SFTP/S3). */
  MAX_PREVIEW_BYTES: 50 * 1024 * 1024,
  /** Hard cap on terminal scrollback lines (settings UI clamps to this). */
  MAX_SCROLLBACK: 100_000,
  /** Minimum terminal font size (px). */
  MIN_FONT_SIZE: 8,
  /** Maximum terminal font size (px). */
  MAX_FONT_SIZE: 32,
  /** Default terminal font size (px). */
  DEFAULT_FONT_SIZE: 14,
  /** Hard cap on concurrent SFTP transfers. */
  MAX_CONCURRENT_TRANSFERS: 10,
  /** Per-op SFTP timeout (ms). list/stat/mkdir/rename/delete/read all use this. */
  SFTP_OP_TIMEOUT_MS: 30_000,
  /** Hard cap on transfers waiting in the queue (excluding in-flight). Protects main process from OOM. */
  MAX_QUEUED_TRANSFERS: 1_000,
  /** Per-op SSH connect timeout (ms). Wraps the entire connect promise so renderers never hang. */
  SSH_CONNECT_TIMEOUT_MS: 60_000,
} as const;
