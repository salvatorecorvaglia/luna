import type { StorageProviderKind } from './storage-provider';

export type AuthType = 'password' | 'key' | 'key+passphrase';

export interface PortForwardingConfig {
  id: string;
  name?: string;
  type: 'local' | 'remote' | 'dynamic';
  bindAddress: string;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
}

export interface ManualJumpHostConfig {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
}

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
  /**
   * Optional reference to another SFTP connection that should be used as a
   * jump host (bastion). When set, the SSH client tunnels through the
   * referenced connection's session via ssh2's `forwardOut` channel.
   * Single-hop only: a chained-through connection cannot itself have a
   * `jumpHostConnectionId` set.
   */
  jumpHostConnectionId?: string;
  /**
   * Manual jump host configuration. Used when jumpHostConnectionId is not set.
   */
  jumpHostConfig?: ManualJumpHostConfig;
  isHidden?: boolean;
  lastConnectedAt?: number;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  portForwards?: PortForwardingConfig[];
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
  /** Optional id of another SFTP connection to use as a jump host. */
  jumpHostConnectionId?: string | null;
  /** Optional manual jump host configuration. */
  jumpHostConfig?: ManualJumpHostConfig | null;
  isHidden?: boolean;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  portForwards?: PortForwardingConfig[];
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
  sortOrder?: number;
  jumpHostConnectionId?: string;
  /**
   * Name of the referenced jump host connection. Exports carry the *name*
   * (not the id) so importers can re-link by name on the destination machine.
   */
  jumpHostName?: string;
  /**
   * Optional manual jump host configuration. Used when jumpHostName is not set.
   */
  jumpHostConfig?: ManualJumpHostConfig;
  isHidden?: boolean;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  portForwards?: PortForwardingConfig[];
}

export interface ConnectionHistory {
  id: string;
  connectionId: string;
  connectedAt: number;
  disconnectedAt?: number;
  durationSecs?: number;
  error?: string;
}
