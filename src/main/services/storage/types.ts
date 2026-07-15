import type {
  StorageEntry,
  StorageProviderKind,
  StorageStatResult,
} from '@shared/types/storage-provider';

export type StepCallback = (transferred: number, chunk: number, total: number) => void;

/**
 * Provider-agnostic storage backend. Both `sftp-manager` and `s3-provider`
 * implement this so the transfer queue and the unified `storage:*` IPC
 * handlers can dispatch by sessionId without caring which kind of remote
 * is on the other end.
 */
export interface StorageProvider {
  readonly kind: StorageProviderKind;

  list(sessionId: string, path: string): Promise<StorageEntry[]>;
  stat(sessionId: string, path: string): Promise<StorageStatResult>;
  mkdir(sessionId: string, path: string): Promise<void>;
  rename(sessionId: string, oldPath: string, newPath: string): Promise<void>;
  remove(sessionId: string, path: string, isDirectory: boolean): Promise<void>;
  readFile(
    sessionId: string,
    path: string,
    maxSize?: number,
  ): Promise<{ content: string; encoding: 'utf-8' | 'base64' }>;
  writeFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<void>;
  statSize(sessionId: string, path: string): Promise<number>;

  streamDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void>;

  streamUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void>;

  /** Tear down per-session state (S3 client, SFTP channel). Idempotent. */
  closeSession(sessionId: string): void | Promise<void>;
}
