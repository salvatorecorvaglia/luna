import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/constants'
import type {
  SshDataEvent,
  SshCloseEvent,
  SshErrorEvent,
  SshStatusEvent,
  SshHostKeyChangeEvent,
  SshConnectParams,
  SshSendDataParams,
  SshResizeParams
} from '@shared/types/terminal'
import type {
  TransferProgressEvent,
  TransferCompleteEvent,
  TransferErrorEvent
} from '@shared/types/transfer'
import type {
  CreateConnectionInput,
  UpdateConnectionInput,
  ExportedConnection
} from '@shared/types/connection'
import type {
  SftpListParams,
  SftpStatParams,
  SftpStatResult,
  SftpMkdirParams,
  SftpRenameParams,
  SftpDeleteParams,
  SftpReadFileParams,
  SftpTransferParams
} from '@shared/types/sftp'

type CleanupFn = () => void

function createEventListener<T>(channel: string) {
  return (callback: (payload: T) => void): CleanupFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
      callback(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED) as Promise<boolean>
  },

  // Connection CRUD
  connections: {
    list: () => ipcRenderer.invoke(IPC.CONNECTION_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.CONNECTION_GET, id),
    create: (input: CreateConnectionInput) => ipcRenderer.invoke(IPC.CONNECTION_CREATE, input),
    update: (input: UpdateConnectionInput) => ipcRenderer.invoke(IPC.CONNECTION_UPDATE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.CONNECTION_DELETE, id),
    export: () => ipcRenderer.invoke(IPC.CONNECTION_EXPORT) as Promise<ExportedConnection[]>,
    import: (connections: ExportedConnection[]) =>
      ipcRenderer.invoke(IPC.CONNECTION_IMPORT, connections) as Promise<number>,
    importFromFile: () => ipcRenderer.invoke(IPC.CONNECTION_IMPORT_FROM_FILE) as Promise<number>
  },

  // SSH sessions
  ssh: {
    connect: (params: SshConnectParams) => ipcRenderer.invoke(IPC.SSH_CONNECT, params),
    testConnection: (params: { connectionId: string }) =>
      ipcRenderer.invoke(IPC.SSH_TEST_CONNECTION, params) as Promise<{
        ok: boolean
        error?: string
      }>,
    disconnect: (sessionId: string) => ipcRenderer.invoke(IPC.SSH_DISCONNECT, sessionId),
    sendData: (params: SshSendDataParams) => ipcRenderer.invoke(IPC.SSH_SEND_DATA, params),
    resize: (params: SshResizeParams) => ipcRenderer.invoke(IPC.SSH_RESIZE, params),
    onData: createEventListener<SshDataEvent>(IPC.SSH_ON_DATA),
    onClose: createEventListener<SshCloseEvent>(IPC.SSH_ON_CLOSE),
    onError: createEventListener<SshErrorEvent>(IPC.SSH_ON_ERROR),
    onStatus: createEventListener<SshStatusEvent>(IPC.SSH_ON_STATUS),
    onHostKeyChange: createEventListener<SshHostKeyChangeEvent>(IPC.SSH_ON_HOST_KEY_CHANGE),
    trustHostKey: (params: { host: string; port: number }) =>
      ipcRenderer.invoke(IPC.SSH_TRUST_HOST_KEY, params) as Promise<{
        trusted: boolean
        fingerprint?: string
      }>
  },

  // SFTP operations
  sftp: {
    list: (params: SftpListParams) => ipcRenderer.invoke(IPC.SFTP_LIST, params),
    stat: (params: SftpStatParams) =>
      ipcRenderer.invoke(IPC.SFTP_STAT, params) as Promise<SftpStatResult>,
    mkdir: (params: SftpMkdirParams) => ipcRenderer.invoke(IPC.SFTP_MKDIR, params),
    rename: (params: SftpRenameParams) => ipcRenderer.invoke(IPC.SFTP_RENAME, params),
    delete: (params: SftpDeleteParams) => ipcRenderer.invoke(IPC.SFTP_DELETE, params),
    readFile: (params: SftpReadFileParams) => ipcRenderer.invoke(IPC.SFTP_READ_FILE, params),
    download: (params: SftpTransferParams) => ipcRenderer.invoke(IPC.SFTP_DOWNLOAD, params),
    upload: (params: SftpTransferParams) => ipcRenderer.invoke(IPC.SFTP_UPLOAD, params)
  },

  // Local filesystem
  shell: {
    readdir: (path: string) => ipcRenderer.invoke(IPC.SHELL_READDIR, path),
    homeDir: () => ipcRenderer.invoke(IPC.SHELL_HOME_DIR),
    openFileDialog: (options?: unknown) => ipcRenderer.invoke(IPC.SHELL_OPEN_FILE_DIALOG, options),
    saveFileDialog: (options: {
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
      content: string
    }) => ipcRenderer.invoke(IPC.SHELL_SAVE_FILE_DIALOG, options) as Promise<string | null>,
    joinPath: (base: string, fileName: string) =>
      ipcRenderer.invoke(IPC.SHELL_JOIN_PATH, { base, fileName }) as Promise<string>
  },

  // Transfer events
  transfers: {
    cancel: (transferId: string) => ipcRenderer.invoke(IPC.TRANSFER_CANCEL, transferId),
    onProgress: createEventListener<TransferProgressEvent>(IPC.TRANSFER_PROGRESS),
    onComplete: createEventListener<TransferCompleteEvent>(IPC.TRANSFER_COMPLETE),
    onError: createEventListener<TransferErrorEvent>(IPC.TRANSFER_ERROR),
    onCancelled: createEventListener<TransferCompleteEvent>(IPC.TRANSFER_CANCELLED)
  },

  // Credentials
  credentials: {
    store: (connectionId: string, secret: string) =>
      ipcRenderer.invoke(IPC.CREDENTIAL_STORE, { connectionId, secret }),
    retrieve: (connectionId: string) => ipcRenderer.invoke(IPC.CREDENTIAL_RETRIEVE, connectionId),
    delete: (connectionId: string) => ipcRenderer.invoke(IPC.CREDENTIAL_DELETE, connectionId)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, { key, value }),
    getAll: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL)
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke(IPC.APP_GET_VERSION) as Promise<string>,
    checkUpdate: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATE),
    installUpdate: () => ipcRenderer.invoke(IPC.APP_INSTALL_UPDATE),
    getLogPath: () => ipcRenderer.invoke(IPC.APP_GET_LOG_PATH) as Promise<string>,
    openLogFile: () => ipcRenderer.invoke(IPC.APP_OPEN_LOG_FILE)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type LunarAPI = typeof api
