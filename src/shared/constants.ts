export const IPC = {
  // Connections
  CONNECTION_LIST: 'connection:list',
  CONNECTION_GET: 'connection:get',
  CONNECTION_CREATE: 'connection:create',
  CONNECTION_UPDATE: 'connection:update',
  CONNECTION_RENAME_FOLDER: 'connection:rename-folder',
  CONNECTION_DELETE: 'connection:delete',
  CONNECTION_DELETE_ALL: 'connection:delete-all',
  CONNECTION_REORDER: 'connection:reorder',
  CONNECTION_EXPORT: 'connection:export',
  CONNECTION_IMPORT: 'connection:import',
  CONNECTION_IMPORT_FROM_FILE: 'connection:import-from-file',
  CONNECTION_IMPORT_SSH_CONFIG: 'connection:import-ssh-config',

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
  SSH_LIST_ACTIVE_PORT_FORWARDS: 'ssh:list-active-port-forwards',
  SSH_START_PORT_FORWARD: 'ssh:start-port-forward',
  SSH_STOP_PORT_FORWARD: 'ssh:stop-port-forward',

  // Storage (provider-agnostic — works for both SFTP and S3 sessions via the registry)
  STORAGE_LIST: 'storage:list',
  STORAGE_STAT: 'storage:stat',
  STORAGE_MKDIR: 'storage:mkdir',
  STORAGE_RENAME: 'storage:rename',
  STORAGE_DELETE: 'storage:delete',
  STORAGE_READ_FILE: 'storage:read-file',
  STORAGE_WRITE_FILE: 'storage:write-file',
  STORAGE_DOWNLOAD: 'storage:download',
  STORAGE_UPLOAD: 'storage:upload',
  /** Fired when a list() call hit the safety cap and stopped paginating. */
  STORAGE_LIST_TRUNCATED: 'storage:list-truncated',

  // S3
  S3_CONNECT: 's3:connect',
  S3_DISCONNECT: 's3:disconnect',
  S3_TEST_CONNECTION: 's3:test-connection',
  S3_GENERATE_PRESIGNED_URL: 's3:generate-presigned-url',

  // Local filesystem
  SHELL_READDIR: 'shell:readdir',
  SHELL_HOME_DIR: 'shell:home-dir',
  SHELL_OPEN_FILE_DIALOG: 'shell:open-file-dialog',
  SHELL_JOIN_PATH: 'shell:join-path',
  SHELL_SAVE_FILE_DIALOG: 'shell:save-file-dialog',
  SHELL_CHECK_FILE: 'shell:check-file',
  SHELL_READ_FILE: 'shell:read-file',
  SHELL_WRITE_FILE: 'shell:write-file',

  // Local terminal (PTY)
  LOCAL_TERMINAL_SPAWN: 'local-terminal:spawn',
  LOCAL_TERMINAL_KILL: 'local-terminal:kill',
  LOCAL_TERMINAL_SEND_DATA: 'local-terminal:send-data',
  LOCAL_TERMINAL_RESIZE: 'local-terminal:resize',

  // Local terminal events (main -> renderer)
  LOCAL_TERMINAL_ON_DATA: 'local-terminal:on-data',
  LOCAL_TERMINAL_ON_EXIT: 'local-terminal:on-exit',

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
  CREDENTIAL_ON_TAMPER: 'credential:on-tamper',

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

  SSH_TEST_CONNECTION: 'ssh:test-connection',
  // Logging
  LOG_MESSAGE: 'log:message',

  // Snippets
  SNIPPET_LIST: 'snippet:list',
  SNIPPET_CREATE: 'snippet:create',
  SNIPPET_UPDATE: 'snippet:update',
  SNIPPET_DELETE: 'snippet:delete',

  // Workspaces
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_DELETE: 'workspace:delete',
} as const;

/** Resource limits — centralised so renderer + main agree. */
export const LIMITS = {
  /** Maximum file preview size (bytes). Larger files are refused at the storage layer (SFTP/S3). */
  MAX_PREVIEW_BYTES: 5 * 1024 * 1024,
  /** Hard cap on terminal scrollback lines (settings UI clamps to this). */
  MAX_SCROLLBACK: 100_000,
  /** Minimum terminal scrollback lines. Must match the clamp in SETTINGS_SET. */
  MIN_SCROLLBACK: 1_000,
  /** Minimum terminal font size (px). */
  MIN_FONT_SIZE: 8,
  /** Maximum terminal font size (px). */
  MAX_FONT_SIZE: 32,
  /** Default terminal font size (px). */
  DEFAULT_FONT_SIZE: 14,
  /** Hard cap on concurrent SFTP transfers. */
  MAX_CONCURRENT_TRANSFERS: 10,
  /** Per-op storage timeout (ms). list/stat/mkdir/rename/delete/read all use this. */
  STORAGE_OP_TIMEOUT_MS: 30_000,
  /** Hard cap on transfers waiting in the queue (excluding in-flight). Protects main process from OOM. */
  MAX_QUEUED_TRANSFERS: 1_000,
  /** Per-op SSH connect timeout (ms). Wraps the entire connect promise so renderers never hang. */
  SSH_CONNECT_TIMEOUT_MS: 60_000,
  /** Maximum total entries returned by a single S3 list call. Prevents OOM on huge buckets. */
  MAX_S3_LIST_ENTRIES: 50_000,
} as const;

/**
 * File extensions treated as binary for preview purposes. Shared between
 * SFTP and S3 readFile implementations to avoid drift.
 */
export const BINARY_PREVIEW_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'bmp',
  'pdf',
]);
