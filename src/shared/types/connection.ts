import type { StorageProviderKind } from './storage-provider';

export type AuthType = 'password' | 'key' | 'key+passphrase';

export interface Connection {
  id: string;
  name: string;
  /** Defaults to 'sftp' for legacy rows that predate the provider column. */
  provider: StorageProviderKind;
  /** SSH-only when provider === 'sftp'. May be empty for S3 connections. */
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  // S3-only fields. All optional and ignored when provider === 'sftp'.
  endpoint?: string;
  region?: string;
  defaultBucket?: string;
  forcePathStyle?: boolean;
  folder: string;
  colorTag?: string;
  sortOrder?: number;
  lastConnectedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConnectionInput {
  name: string;
  provider?: StorageProviderKind;
  // SFTP fields
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  // S3 fields
  endpoint?: string;
  region?: string;
  defaultBucket?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  // Common
  folder?: string;
  colorTag?: string;
}

export interface UpdateConnectionInput extends Partial<CreateConnectionInput> {
  id: string;
}

/** Connection data for import/export (no credentials or internal IDs). */
export interface ExportedConnection {
  name: string;
  provider?: StorageProviderKind;
  host?: string;
  port?: number;
  username?: string;
  authType?: AuthType;
  privateKeyPath?: string;
  endpoint?: string;
  region?: string;
  defaultBucket?: string;
  forcePathStyle?: boolean;
  folder?: string;
  colorTag?: string;
}

export interface ConnectionHistory {
  id: string;
  connectionId: string;
  connectedAt: number;
  disconnectedAt?: number;
  durationSecs?: number;
  error?: string;
}
