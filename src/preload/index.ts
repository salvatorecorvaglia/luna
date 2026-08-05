import { IPC } from '@shared/constants';
import { ErrorCode } from '@shared/errors';
import type {
  AuthType,
  CreateConnectionInput,
  ExportedConnection,
  PortForwardingConfig,
  UpdateConnectionInput,
} from '@shared/types/connection';
import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
} from '@shared/types/ipc';
// No sftp imports needed here anymore
import type { AuditExportOptions } from '@shared/types/session-audit';
import type { AppSettings } from '@shared/types/settings';
import type { CreateSnippetInput, UpdateSnippetInput } from '@shared/types/snippet';
import type {
  S3ConnectParams,
  S3TestConnectionConfig,
  StorageDeleteParams,
  StorageEntry,
  StorageListParams,
  StorageMkdirParams,
  StorageReadFileParams,
  StorageRenameParams,
  StorageStatParams,
  StorageTransferParams,
} from '@shared/types/storage-provider';
import type { SshConnectParams, SshResizeParams, SshSendDataParams } from '@shared/types/terminal';
import type { CreateWorkspaceInput } from '@shared/types/workspace';
import { contextBridge, ipcRenderer } from 'electron';

type CleanupFn = () => void;

/**
 * Structured error payload handed to the renderer.
 *
 * `contextBridge` clones thrown values, and for an `Error` it preserves only
 * `message` and `stack` — the class, the `name`, and any own properties are
 * dropped. A `LunaError` reconstructed here therefore arrived in the renderer
 * as a bare `Error`, so `err.code` was always undefined and every consumer
 * that branched on it (cancellation detection, the per-code description in
 * `formatError`) silently never fired in a real build. Unit tests could not
 * catch this: they never cross a real bridge.
 *
 * A plain object *is* cloned with all its own properties, so that is what we
 * reject with. `src/renderer/src/services/api.ts` turns it back into a real
 * `LunaError` at the single seam every renderer call already goes through.
 */
export interface IpcErrorPayload {
  /** Discriminator so the renderer seam can tell this from an arbitrary throw. */
  __lunaError: true;
  code: ErrorCode;
  message: string;
}

/**
 * Strip the `Error invoking remote method '<channel>': Error: ` prefix and
 * recover the `{code, message}` main encoded into the message.
 */
function toIpcErrorPayload(err: unknown): IpcErrorPayload {
  const fallback = (message: string, code = ErrorCode.INTERNAL_ERROR): IpcErrorPayload => ({
    __lunaError: true,
    code,
    message,
  });

  if (!(err instanceof Error)) return fallback(String(err));

  const match = err.message.match(/^Error invoking remote method '[^']+': (?:Error: )?(.*)$/s);
  const message = match ? match[1] : err.message;

  if (message.startsWith('{') && message.endsWith('}')) {
    try {
      const parsed = JSON.parse(message) as { code?: ErrorCode; message?: string };
      if (parsed.code && parsed.message) {
        return fallback(parsed.message, parsed.code);
      }
    } catch {
      // Not our envelope — fall through and surface the raw text.
    }
  }

  return fallback(message);
}

/**
 * Typed wrapper around `ipcRenderer.invoke`. Channel + request + response are
 * all derived from `IpcHandlerMap` so a renaming or shape change in main
 * surfaces as a compile error in the renderer instead of a runtime cast that
 * happened to "look right". Replaces the ~30 manual `as Promise<T>` casts.
 *
 * Overload split so `void`-request channels don't need to pass `undefined`.
 */
function invoke<K extends IpcChannel>(
  channel: K,
  ...args: IpcRequest<K> extends void ? [] : [IpcRequest<K>]
): Promise<IpcResponse<K>>;
function invoke<K extends IpcChannel>(
  channel: K,
  ...args: [IpcRequest<K>?]
): Promise<IpcResponse<K>> {
  const result =
    args.length > 0
      ? (ipcRenderer.invoke(channel, args[0]) as Promise<IpcResponse<K>>)
      : (ipcRenderer.invoke(channel) as Promise<IpcResponse<K>>);
  return result.catch((err) => {
    throw toIpcErrorPayload(err);
  }) as Promise<IpcResponse<K>>;
}

function createEventListener<K extends IpcEventChannel>(channel: K) {
  return (callback: (payload: IpcEventPayload<K>) => void): CleanupFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<K>): void => {
      callback(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const api = {
  // Window controls
  window: {
    minimize: () => invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => invoke(IPC.WINDOW_MAXIMIZE),
    close: () => invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => invoke(IPC.WINDOW_IS_MAXIMIZED),
  },

  // Connection CRUD
  connections: {
    list: () => invoke(IPC.CONNECTION_LIST),
    get: (id: string) => invoke(IPC.CONNECTION_GET, id),
    create: (input: CreateConnectionInput) => invoke(IPC.CONNECTION_CREATE, input),
    update: (input: UpdateConnectionInput) => invoke(IPC.CONNECTION_UPDATE, input),
    renameFolder: (params: { oldName: string; newName: string; provider: 'sftp' | 's3' }) =>
      invoke(IPC.CONNECTION_RENAME_FOLDER, params),
    delete: (id: string) => invoke(IPC.CONNECTION_DELETE, id),
    deleteAll: () => invoke(IPC.CONNECTION_DELETE_ALL),
    reorder: (ids: string[]) => invoke(IPC.CONNECTION_REORDER, ids),
    export: () => invoke(IPC.CONNECTION_EXPORT),
    import: (connections: ExportedConnection[]) => invoke(IPC.CONNECTION_IMPORT, connections),
    importFromFile: () => invoke(IPC.CONNECTION_IMPORT_FROM_FILE),
    importFromSshConfig: () => invoke(IPC.CONNECTION_IMPORT_SSH_CONFIG),
  },

  // SSH sessions
  ssh: {
    connect: (params: SshConnectParams) => invoke(IPC.SSH_CONNECT, params),
    testConnection: (params: {
      connectionId?: string;
      config?: {
        host: string;
        port: number;
        username: string;
        authType: AuthType;
        privateKeyPath?: string;
        password?: string;
        passphrase?: string;
        keepaliveInterval?: number;
        keepaliveCountMax?: number;
      };
    }) => invoke(IPC.SSH_TEST_CONNECTION, params),
    disconnect: (sessionId: string) => invoke(IPC.SSH_DISCONNECT, sessionId),
    sendData: (params: SshSendDataParams) => invoke(IPC.SSH_SEND_DATA, params),
    resize: (params: SshResizeParams) => invoke(IPC.SSH_RESIZE, params),
    onData: createEventListener(IPC.SSH_ON_DATA),
    onClose: createEventListener(IPC.SSH_ON_CLOSE),
    onError: createEventListener(IPC.SSH_ON_ERROR),
    onStatus: createEventListener(IPC.SSH_ON_STATUS),
    onHostKeyChange: createEventListener(IPC.SSH_ON_HOST_KEY_CHANGE),
    trustHostKey: (params: { host: string; port: number }) =>
      invoke(IPC.SSH_TRUST_HOST_KEY, params),
    listActivePortForwards: (params?: { sessionId?: string }) =>
      invoke(IPC.SSH_LIST_ACTIVE_PORT_FORWARDS, params ?? {}),
    startPortForward: (params: { sessionId: string; config: PortForwardingConfig }) =>
      invoke(IPC.SSH_START_PORT_FORWARD, params),
    stopPortForward: (params: { sessionId: string; forwardId: string }) =>
      invoke(IPC.SSH_STOP_PORT_FORWARD, params),
  },

  // Provider-agnostic storage operations. The main process resolves the
  // session id to the right backend (SFTP or S3) via the storage registry.
  storage: {
    list: (params: StorageListParams) => invoke(IPC.STORAGE_LIST, params),
    stat: (params: StorageStatParams) => invoke(IPC.STORAGE_STAT, params),
    mkdir: (params: StorageMkdirParams) => invoke(IPC.STORAGE_MKDIR, params),
    rename: (params: StorageRenameParams) => invoke(IPC.STORAGE_RENAME, params),
    delete: (params: StorageDeleteParams) => invoke(IPC.STORAGE_DELETE, params),
    readFile: (params: StorageReadFileParams) => invoke(IPC.STORAGE_READ_FILE, params),
    writeFile: (params: { sessionId: string; path: string; content: string }) =>
      invoke(IPC.STORAGE_WRITE_FILE, params),
    download: (params: StorageTransferParams) => invoke(IPC.STORAGE_DOWNLOAD, params),
    upload: (params: StorageTransferParams) => invoke(IPC.STORAGE_UPLOAD, params),
    onListTruncated: createEventListener(IPC.STORAGE_LIST_TRUNCATED),
    compareDirectories: (params: {
      /** Optional: when supplied the call draws from that session's rate bucket. */
      sessionId?: string;
      localEntries: { relativePath: string; size: number; mtime: number }[];
      remoteEntries: StorageEntry[];
      direction?: 'sync-to-remote' | 'sync-to-local' | 'bi-directional';
    }) => invoke(IPC.STORAGE_COMPARE_DIRECTORIES, params),
  },

  // S3 sessions
  s3: {
    connect: (params: S3ConnectParams) => invoke(IPC.S3_CONNECT, params),
    disconnect: (sessionId: string) => invoke(IPC.S3_DISCONNECT, sessionId),
    testConnection: (params: { connectionId?: string; config?: S3TestConnectionConfig }) =>
      invoke(IPC.S3_TEST_CONNECTION, params),
    generatePresignedUrl: (params: { sessionId: string; path: string; expiresSec: number }) =>
      invoke(IPC.S3_GENERATE_PRESIGNED_URL, params),
  },

  // Local filesystem
  shell: {
    readdir: (path: string) => invoke(IPC.SHELL_READDIR, path),
    homeDir: () => invoke(IPC.SHELL_HOME_DIR),
    openFileDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      invoke(IPC.SHELL_OPEN_FILE_DIALOG, options),
    saveFileDialog: (options: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      content: string;
    }) => invoke(IPC.SHELL_SAVE_FILE_DIALOG, options),
    joinPath: (base: string, fileName: string) => invoke(IPC.SHELL_JOIN_PATH, { base, fileName }),
    checkFile: (filePath: string) => invoke(IPC.SHELL_CHECK_FILE, filePath),
    readFile: (filePath: string) => invoke(IPC.SHELL_READ_FILE, filePath),
    writeFile: (filePath: string, content: string) =>
      invoke(IPC.SHELL_WRITE_FILE, { filePath, content }),
    cliReference: (query: string) => invoke(IPC.SHELL_CLI_REFERENCE, query),
    searchHistory: (payload: { query: string; limit?: number }) =>
      invoke(IPC.SHELL_SEARCH_HISTORY, payload),
    exportAuditLog: (options: AuditExportOptions) => invoke(IPC.SHELL_EXPORT_AUDIT_LOG, options),
  },

  // Transfer events
  transfers: {
    cancel: (transferId: string) => invoke(IPC.TRANSFER_CANCEL, transferId),
    cancelBySession: (sessionId: string) => invoke(IPC.TRANSFER_CANCEL_BY_SESSION, sessionId),
    onProgress: createEventListener(IPC.TRANSFER_PROGRESS),
    onComplete: createEventListener(IPC.TRANSFER_COMPLETE),
    onError: createEventListener(IPC.TRANSFER_ERROR),
    onCancelled: createEventListener(IPC.TRANSFER_CANCELLED),
  },

  // Local terminal (PTY)
  localTerminal: {
    spawn: (params: { sessionId: string; cols: number; rows: number }) =>
      invoke(IPC.LOCAL_TERMINAL_SPAWN, params),
    kill: (sessionId: string) => invoke(IPC.LOCAL_TERMINAL_KILL, sessionId),
    sendData: (params: { sessionId: string; data: string }) =>
      invoke(IPC.LOCAL_TERMINAL_SEND_DATA, params),
    resize: (params: { sessionId: string; cols: number; rows: number }) =>
      invoke(IPC.LOCAL_TERMINAL_RESIZE, params),
    onData: createEventListener(IPC.LOCAL_TERMINAL_ON_DATA),
    onExit: createEventListener(IPC.LOCAL_TERMINAL_ON_EXIT),
  },

  // Credentials
  credentials: {
    store: (connectionId: string, secret: string) =>
      invoke(IPC.CREDENTIAL_STORE, { connectionId, secret }),
    retrieve: (connectionId: string) => invoke(IPC.CREDENTIAL_RETRIEVE, connectionId),
    delete: (connectionId: string) => invoke(IPC.CREDENTIAL_DELETE, connectionId),
    onTamper: createEventListener(IPC.CREDENTIAL_ON_TAMPER),
    resolveExternal: (ref: string) => invoke(IPC.CREDENTIAL_RESOLVE_EXTERNAL, ref),
  },

  // Settings
  settings: {
    get: (key: keyof AppSettings) => invoke(IPC.SETTINGS_GET, key),
    set: (key: keyof AppSettings, value: string) => invoke(IPC.SETTINGS_SET, { key, value }),
    getAll: () => invoke(IPC.SETTINGS_GET_ALL),
  },

  // App info & updates
  app: {
    getVersion: () => invoke(IPC.APP_GET_VERSION),
    checkUpdate: () => invoke(IPC.APP_CHECK_UPDATE),
    installUpdate: () => invoke(IPC.APP_INSTALL_UPDATE),
    getLogPath: () => invoke(IPC.APP_GET_LOG_PATH),
    openLogFile: () => invoke(IPC.APP_OPEN_LOG_FILE),
    getActiveSessions: () => invoke(IPC.APP_GET_ACTIVE_SESSIONS),
    getCredentialBackend: () => invoke(IPC.APP_GET_CREDENTIAL_BACKEND),
    onUpdateAvailable: createEventListener(IPC.APP_UPDATE_AVAILABLE),
    onUpdateDownloadProgress: createEventListener(IPC.APP_UPDATE_DOWNLOAD_PROGRESS),
    onUpdateDownloaded: createEventListener(IPC.APP_UPDATE_DOWNLOADED),
    onUpdateError: createEventListener(IPC.APP_UPDATE_ERROR),
  },

  // Logging
  log: (
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    context?: Record<string, unknown>,
  ) => invoke(IPC.LOG_MESSAGE, { level, message, context }),

  // Snippets
  snippets: {
    list: () => invoke(IPC.SNIPPET_LIST),
    create: (input: CreateSnippetInput) => invoke(IPC.SNIPPET_CREATE, input),
    update: (input: UpdateSnippetInput) => invoke(IPC.SNIPPET_UPDATE, input),
    delete: (id: string) => invoke(IPC.SNIPPET_DELETE, id),
  },

  // Workspaces
  workspaces: {
    list: () => invoke(IPC.WORKSPACE_LIST),
    create: (input: CreateWorkspaceInput) => invoke(IPC.WORKSPACE_CREATE, input),
    delete: (id: string) => invoke(IPC.WORKSPACE_DELETE, id),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type LunaAPI = typeof api;
