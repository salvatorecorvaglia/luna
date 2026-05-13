import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/constants';
import type {
  IpcChannel,
  IpcEventChannel,
  IpcEventPayload,
  IpcRequest,
  IpcResponse,
} from '@shared/types/ipc';
import type { SshConnectParams, SshResizeParams, SshSendDataParams } from '@shared/types/terminal';
import type {
  AuthType,
  CreateConnectionInput,
  ExportedConnection,
  UpdateConnectionInput,
} from '@shared/types/connection';
import type {
  SftpDeleteParams,
  SftpListParams,
  SftpMkdirParams,
  SftpReadFileParams,
  SftpRenameParams,
  SftpStatParams,
  SftpTransferParams,
} from '@shared/types/sftp';
import type {
  S3ConnectParams,
  S3TestConnectionConfig,
  StorageDeleteParams,
  StorageListParams,
  StorageMkdirParams,
  StorageReadFileParams,
  StorageRenameParams,
  StorageStatParams,
  StorageTransferParams,
} from '@shared/types/storage-provider';
import { LunarError, ErrorCode } from '@shared/errors';

type CleanupFn = () => void;

/**
 * Strip the `Error invoking remote method '<channel>': Error: ` prefix and
 * reconstitute a LunarError if the underlying error is structured.
 */
function unwrapIpcError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;

  // Electron's default prefix
  const match = err.message.match(/^Error invoking remote method '[^']+': (?:Error: )?(.*)$/s);
  const message = match ? match[1] : err.message;

  // Try to see if the message is a JSON-serialized LunarError
  // (In some Electron versions/configs, custom Error properties might not survive,
  // but if we throw a LunarError it might have those properties if it's the same process,
  // but across IPC they might be lost depending on Electron version.)

  // If it's already an object with 'code' and 'message', it might have survived serialization
  if ('code' in err && 'message' in err) {
    return LunarError.fromUnknown(err);
  }

  // If it's a string that looks like JSON, it might be our serialized error
  if (message.startsWith('{') && message.endsWith('}')) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.code && parsed.message) {
        return LunarError.fromUnknown(parsed);
      }
    } catch {
      // Not JSON, continue with original message
    }
  }

  // If it's a standard error, just wrap it as INTERNAL_ERROR
  return new LunarError(message, ErrorCode.INTERNAL_ERROR);
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
  request?: IpcRequest<K>,
): Promise<IpcResponse<K>> {
  const result =
    arguments.length > 1
      ? (ipcRenderer.invoke(channel, request) as Promise<IpcResponse<K>>)
      : (ipcRenderer.invoke(channel) as Promise<IpcResponse<K>>);
  return result.catch((err) => {
    throw unwrapIpcError(err);
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
    delete: (id: string) => invoke(IPC.CONNECTION_DELETE, id),
    deleteAll: () => invoke(IPC.CONNECTION_DELETE_ALL),
    reorder: (ids: string[]) => invoke(IPC.CONNECTION_REORDER, ids),
    export: () => invoke(IPC.CONNECTION_EXPORT),
    import: (connections: ExportedConnection[]) => invoke(IPC.CONNECTION_IMPORT, connections),
    importFromFile: () => invoke(IPC.CONNECTION_IMPORT_FROM_FILE),
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
  },

  // SFTP operations (legacy — prefer `api.storage.*` going forward; both routes
  // hit the same SftpManager, so this stays safe to call.)
  sftp: {
    list: (params: SftpListParams) => invoke(IPC.SFTP_LIST, params),
    stat: (params: SftpStatParams) => invoke(IPC.SFTP_STAT, params),
    mkdir: (params: SftpMkdirParams) => invoke(IPC.SFTP_MKDIR, params),
    rename: (params: SftpRenameParams) => invoke(IPC.SFTP_RENAME, params),
    delete: (params: SftpDeleteParams) => invoke(IPC.SFTP_DELETE, params),
    readFile: (params: SftpReadFileParams) => invoke(IPC.SFTP_READ_FILE, params),
    download: (params: SftpTransferParams) => invoke(IPC.SFTP_DOWNLOAD, params),
    upload: (params: SftpTransferParams) => invoke(IPC.SFTP_UPLOAD, params),
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
    download: (params: StorageTransferParams) => invoke(IPC.STORAGE_DOWNLOAD, params),
    upload: (params: StorageTransferParams) => invoke(IPC.STORAGE_UPLOAD, params),
  },

  // S3 sessions
  s3: {
    connect: (params: S3ConnectParams) => invoke(IPC.S3_CONNECT, params),
    disconnect: (sessionId: string) => invoke(IPC.S3_DISCONNECT, sessionId),
    testConnection: (params: { connectionId?: string; config?: S3TestConnectionConfig }) =>
      invoke(IPC.S3_TEST_CONNECTION, params),
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
  },

  // Settings
  settings: {
    get: (key: string) => invoke(IPC.SETTINGS_GET, key as never),
    set: (key: string, value: string) => invoke(IPC.SETTINGS_SET, { key: key as never, value }),
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
};

contextBridge.exposeInMainWorld('api', api);

export type LunarAPI = typeof api;
