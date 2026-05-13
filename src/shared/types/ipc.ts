import type {
  AuthType,
  Connection,
  CreateConnectionInput,
  ExportedConnection,
  ManualJumpHostConfig,
  UpdateConnectionInput,
} from './connection';
import type {
  SshCloseEvent,
  SshConnectParams,
  SshConnectResult,
  SshDataEvent,
  SshErrorEvent,
  SshHostKeyChangeEvent,
  SshResizeParams,
  SshSendDataParams,
  SshStatusEvent,
  SessionStatus,
} from './terminal';
import type { LocalFileEntry } from './sftp';
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
  StorageStatResult,
  StorageTransferParams,
} from './storage-provider';
import type { TransferCompleteEvent, TransferErrorEvent, TransferProgressEvent } from './transfer';
import type { AppSettings } from './settings';

/**
 * Authoritative request/response shape for every invoke-style IPC channel.
 *
 * Keeping this map exhaustive (including handlers that previously lived as
 * `as Promise<T>` casts in preload/index.ts) lets the preload bridge derive
 * its types directly via the `invoke<K>(channel, req)` helper — drift between
 * handler and consumer becomes a compile error, not a runtime surprise.
 */
export interface IpcHandlerMap {
  // Connections
  'connection:list': { request: void; response: Connection[] };
  'connection:get': { request: string; response: Connection | null };
  'connection:create': { request: CreateConnectionInput; response: Connection };
  'connection:update': { request: UpdateConnectionInput; response: Connection };
  'connection:delete': { request: string; response: void };
  'connection:delete-all': { request: void; response: void };
  'connection:reorder': { request: string[]; response: void };
  'connection:export': { request: void; response: ExportedConnection[] };
  'connection:import': {
    request: ExportedConnection[];
    response: { imported: number; skipped: { name: string; reason: string }[] };
  };
  'connection:import-from-file': {
    request: void;
    response: { imported: number; skipped: { name: string; reason: string }[] };
  };

  // SSH
  'ssh:connect': { request: SshConnectParams; response: SshConnectResult };
  'ssh:disconnect': { request: string; response: void };
  'ssh:send-data': { request: SshSendDataParams; response: void };
  'ssh:resize': { request: SshResizeParams; response: void };
  'ssh:test-connection': {
    request: {
      connectionId?: string;
      config?: {
        host: string;
        port: number;
        username: string;
        authType: AuthType;
        privateKeyPath?: string;
        password?: string;
        passphrase?: string;
        jumpHostConnectionId?: string;
        jumpHostConfig?: ManualJumpHostConfig;
      };
    };
    response: { ok: boolean; error?: string };
  };
  'ssh:trust-host-key': {
    request: { host: string; port: number };
    response: { trusted: boolean; fingerprint?: string };
  };

  // Storage (provider-agnostic)
  'storage:list': { request: StorageListParams; response: StorageEntry[] };
  'storage:stat': { request: StorageStatParams; response: StorageStatResult };
  'storage:mkdir': { request: StorageMkdirParams; response: void };
  'storage:rename': { request: StorageRenameParams; response: void };
  'storage:delete': { request: StorageDeleteParams; response: void };
  'storage:read-file': {
    request: StorageReadFileParams;
    response: { content: string; encoding: 'utf-8' | 'base64' };
  };
  'storage:download': { request: StorageTransferParams; response: string };
  'storage:upload': { request: StorageTransferParams; response: string };

  // S3
  's3:connect': { request: S3ConnectParams; response: { sessionId: string } };
  's3:disconnect': { request: string; response: void };
  's3:test-connection': {
    request: { connectionId?: string; config?: S3TestConnectionConfig };
    response: { ok: boolean; error?: string };
  };

  // Local filesystem
  'shell:readdir': { request: string; response: LocalFileEntry[] };
  'shell:home-dir': { request: void; response: string };
  'shell:open-file-dialog': {
    request: { filters?: { name: string; extensions: string[] }[] } | undefined;
    response: string | null;
  };
  'shell:save-file-dialog': {
    request: {
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      content: string;
    };
    response: string | null;
  };
  'shell:join-path': { request: { base: string; fileName: string }; response: string };
  'shell:check-file': {
    request: string;
    response:
      | { ok: true }
      | {
          ok: false;
          reason: 'empty' | 'missing' | 'permission' | 'not-a-file' | 'forbidden' | 'unknown';
        };
  };
  'shell:read-file': { request: string; response: { content: string; size: number } };

  // Local terminal (PTY)
  'local-terminal:spawn': {
    request: { sessionId: string; cols: number; rows: number };
    response: void;
  };
  'local-terminal:kill': { request: string; response: void };
  'local-terminal:send-data': { request: { sessionId: string; data: string }; response: void };
  'local-terminal:resize': {
    request: { sessionId: string; cols: number; rows: number };
    response: void;
  };

  // Transfers
  'transfer:cancel': { request: string; response: void };
  'transfer:cancel-by-session': { request: string; response: void };

  // Credentials
  'credential:store': { request: { connectionId: string; secret: string }; response: void };
  'credential:retrieve': { request: string; response: string | null };
  'credential:delete': { request: string; response: void };

  // Settings
  'settings:get': { request: keyof AppSettings; response: string };
  'settings:set': { request: { key: keyof AppSettings; value: string }; response: void };
  'settings:get-all': { request: void; response: Partial<AppSettings> };

  // Window
  'window:minimize': { request: void; response: void };
  'window:maximize': { request: void; response: void };
  'window:close': { request: void; response: void };
  'window:is-maximized': { request: void; response: boolean };

  // App
  'app:get-version': { request: void; response: string };
  'app:check-update': { request: void; response: { available: boolean; version?: string } };
  'app:install-update': { request: void; response: void };
  'app:get-log-path': { request: void; response: string };
  'app:open-log-file': { request: void; response: void };
  'app:get-active-sessions': {
    request: void;
    response: {
      ssh: { id: string; connectionId: string; status: SessionStatus }[];
      s3: {
        id: string;
        connectionId: string;
        connectionName: string;
        initialPath: string;
      }[];
    };
  };
  'app:get-credential-backend': {
    request: void;
    response: { backend: 'safeStorage' | 'plaintext' | 'uninitialized' };
  };

  // Logging
  'log:message': {
    request: {
      level: 'info' | 'warn' | 'error' | 'debug';
      message: string;
      context?: Record<string, unknown>;
    };
    response: void;
  };
}

// Streaming events (main -> renderer, via webContents.send)
export interface IpcEventMap {
  'ssh:on-data': SshDataEvent;
  'ssh:on-close': SshCloseEvent;
  'ssh:on-error': SshErrorEvent;
  'ssh:on-status': SshStatusEvent;
  'ssh:on-host-key-change': SshHostKeyChangeEvent;
  'transfer:progress': TransferProgressEvent;
  'transfer:complete': TransferCompleteEvent;
  'transfer:error': TransferErrorEvent;
  'transfer:cancelled': TransferCompleteEvent;
  'credential:on-tamper': { connectionId: string; reason: string; at: number };
  'app:update-available': { version: string };
  'app:update-download-progress': { percent: number; bytesPerSecond: number };
  'app:update-downloaded': Record<string, never>;
  'app:update-error': { error: string };

  // Local terminal events
  'local-terminal:on-data': { sessionId: string; data: string };
  'local-terminal:on-exit': { sessionId: string; exitCode: number };
}

/** Convenience aliases for invoke<channel, req, res> helpers. */
export type IpcChannel = keyof IpcHandlerMap;
export type IpcRequest<K extends IpcChannel> = IpcHandlerMap[K]['request'];
export type IpcResponse<K extends IpcChannel> = IpcHandlerMap[K]['response'];

export type IpcEventChannel = keyof IpcEventMap;
export type IpcEventPayload<K extends IpcEventChannel> = IpcEventMap[K];

// Re-export all types for convenience
export type * from './connection';
export type * from './terminal';
export type * from './sftp';
export type * from './storage-provider';
export type * from './transfer';
export type * from './settings';
