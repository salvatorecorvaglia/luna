export type StorageProviderKind = 'sftp' | 's3';

/** Unified directory entry that works for SFTP, local FS, and S3 (where
 * `isPrefix` distinguishes a CommonPrefix from an actual object key). */
export interface StorageEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSymlink: boolean;
  /** S3-only: true when this entry represents a bucket or a CommonPrefix
   * rather than a real object. SFTP entries leave this undefined. */
  isPrefix?: boolean;
  /** Present for SFTP and zero/missing for S3. */
  permissions?: string;
  owner?: number;
  group?: number;
}

export interface StorageStatResult {
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions?: string;
}

export interface StorageListParams {
  sessionId: string;
  path: string;
}
export interface StorageStatParams {
  sessionId: string;
  path: string;
}
export interface StorageMkdirParams {
  sessionId: string;
  path: string;
}
export interface StorageRenameParams {
  sessionId: string;
  oldPath: string;
  newPath: string;
}
export interface StorageDeleteParams {
  sessionId: string;
  path: string;
  isDirectory: boolean;
}
export interface StorageReadFileParams {
  sessionId: string;
  path: string;
  maxSize?: number;
}
export interface StorageTransferParams {
  sessionId: string;
  localPath: string;
  remotePath: string;
}

export interface S3ConnectParams {
  /** Session id chosen by the renderer (uuid). Mirrors the SSH connect contract. */
  sessionId: string;
  connectionId: string;
}

export interface S3TestConnectionConfig {
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  defaultBucket?: string;
}
