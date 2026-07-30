import type { CliCommandDoc } from './cli-reference';
import type {
  ActivePortForwardInfo,
  AuthType,
  Connection,
  CreateConnectionInput,
  ExportedConnection,
  ManualJumpHostConfig,
  PortForwardingConfig,
  UpdateConnectionInput,
} from './connection';
import type { FolderDiffResult } from './folder-sync';
import type { AuditExportOptions } from './session-audit';
import type { AppSettings } from './settings';
import type { LocalFileEntry } from './sftp';
import type { HistoryMatch } from './shell-history';
import type { CreateSnippetInput, Snippet, UpdateSnippetInput } from './snippet';
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
import type {
  SessionStatus,
  SshCloseEvent,
  SshConnectParams,
  SshConnectResult,
  SshDataEvent,
  SshErrorEvent,
  SshHostKeyChangeEvent,
  SshResizeParams,
  SshSendDataParams,
  SshStatusEvent,
} from './terminal';
import type { TransferCompleteEvent, TransferErrorEvent, TransferProgressEvent } from './transfer';
import type { CreateWorkspaceInput, WorkspacePreset } from './workspace';

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
  'connection:rename-folder': {
    request: { oldName: string; newName: string; provider: 'sftp' | 's3' };
    response: void;
  };
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
  'connection:import-ssh-config': {
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
        keepaliveInterval?: number;
        keepaliveCountMax?: number;
      };
    };
    response: { ok: boolean; error?: string };
  };
  'ssh:trust-host-key': {
    request: { host: string; port: number };
    response: { trusted: boolean; fingerprint?: string };
  };
  'ssh:list-active-port-forwards': {
    request: { sessionId?: string };
    response: ActivePortForwardInfo[];
  };
  'ssh:start-port-forward': {
    request: { sessionId: string; config: PortForwardingConfig };
    response: ActivePortForwardInfo;
  };
  'ssh:stop-port-forward': {
    request: { sessionId: string; forwardId: string };
    response: void;
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
  'storage:write-file': {
    request: { sessionId: string; path: string; content: string };
    response: void;
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
  's3:generate-presigned-url': {
    request: { sessionId: string; path: string; expiresSec: number };
    response: string;
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
  'shell:write-file': { request: { filePath: string; content: string }; response: void };
  'shell:cli-reference': { request: string; response: CliCommandDoc[] };
  'shell:search-history': { request: { query: string; limit?: number }; response: HistoryMatch[] };
  'shell:export-audit-log': {
    request: AuditExportOptions;
    response: { success: boolean; path: string };
  };

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
  'credential:resolve-external': { request: string; response: string | null };
  'storage:compare-directories': {
    request: {
      localEntries: { relativePath: string; size: number; mtime: number }[];
      remoteEntries: StorageEntry[];
      direction?: 'sync-to-remote' | 'sync-to-local' | 'bi-directional';
    };
    response: FolderDiffResult;
  };

  // Settings
  'settings:get': { request: keyof AppSettings; response: string | null };
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
    response: { backend: 'safeStorage' | 'plaintext' | 'inMemory' | 'uninitialized' };
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

  // Snippets
  'snippet:list': { request: void; response: Snippet[] };
  'snippet:create': { request: CreateSnippetInput; response: Snippet };
  'snippet:update': { request: UpdateSnippetInput; response: Snippet };
  'snippet:delete': { request: string; response: void };

  // Workspaces
  'workspace:list': { request: void; response: WorkspacePreset[] };
  'workspace:create': { request: CreateWorkspaceInput; response: WorkspacePreset };
  'workspace:delete': { request: string; response: void };
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
  'storage:list-truncated': {
    sessionId: string;
    path: string;
    /** Number of entries returned before truncation kicked in. */
    returned: number;
    /** The hard cap that triggered truncation (so the UI can quote it). */
    limit: number;
  };
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
export type * from './settings';
export type * from './sftp';
export type * from './snippet';
export type * from './storage-provider';
export type * from './terminal';
export type * from './transfer';
export type * from './workspace';
