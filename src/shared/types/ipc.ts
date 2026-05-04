import type { Connection, CreateConnectionInput, UpdateConnectionInput } from './connection';
import type {
  SshCloseEvent,
  SshConnectParams,
  SshConnectResult,
  SshDataEvent,
  SshErrorEvent,
  SshResizeParams,
  SshSendDataParams,
  SshStatusEvent,
} from './terminal';
import type {
  LocalFileEntry,
  SftpDeleteParams,
  SftpEntry,
  SftpListParams,
  SftpMkdirParams,
  SftpReadFileParams,
  SftpRenameParams,
  SftpTransferParams,
} from './sftp';
import type { TransferCompleteEvent, TransferErrorEvent, TransferProgressEvent } from './transfer';
import type { AppSettings } from './settings';

// Request-response IPC (invoke/handle)
export interface IpcHandlerMap {
  // Connections
  'connection:list': { request: void; response: Connection[] };
  'connection:get': { request: string; response: Connection | null };
  'connection:create': { request: CreateConnectionInput; response: Connection };
  'connection:update': { request: UpdateConnectionInput; response: Connection };
  'connection:delete': { request: string; response: void };

  // SSH
  'ssh:connect': { request: SshConnectParams; response: SshConnectResult };
  'ssh:disconnect': { request: string; response: void };
  'ssh:send-data': { request: SshSendDataParams; response: void };
  'ssh:resize': { request: SshResizeParams; response: void };

  // SFTP
  'sftp:list': { request: SftpListParams; response: SftpEntry[] };
  'sftp:mkdir': { request: SftpMkdirParams; response: void };
  'sftp:rename': { request: SftpRenameParams; response: void };
  'sftp:delete': { request: SftpDeleteParams; response: void };
  'sftp:read-file': { request: SftpReadFileParams; response: string };
  'sftp:download': { request: SftpTransferParams; response: string };
  'sftp:upload': { request: SftpTransferParams; response: string };

  // Local filesystem
  'shell:readdir': { request: string; response: LocalFileEntry[] };
  'shell:home-dir': { request: void; response: string };
  'shell:open-file-dialog': {
    request: { filters?: { name: string; extensions: string[] }[] };
    response: string | null;
  };

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
}

// Streaming events (main -> renderer, via webContents.send)
export interface IpcEventMap {
  'ssh:on-data': SshDataEvent;
  'ssh:on-close': SshCloseEvent;
  'ssh:on-error': SshErrorEvent;
  'ssh:on-status': SshStatusEvent;
  'transfer:progress': TransferProgressEvent;
  'transfer:complete': TransferCompleteEvent;
  'transfer:error': TransferErrorEvent;
}

// Re-export all types for convenience
export type * from './connection';
export type * from './terminal';
export type * from './sftp';
export type * from './transfer';
export type * from './settings';
