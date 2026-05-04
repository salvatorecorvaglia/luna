export type AuthType = 'password' | 'key' | 'key+passphrase';

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  folder: string;
  colorTag?: string;
  startupCommand?: string;
  lastConnectedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConnectionInput {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  folder?: string;
  colorTag?: string;
  startupCommand?: string;
}

export interface UpdateConnectionInput extends Partial<CreateConnectionInput> {
  id: string;
}

/** Connection data for import/export (no credentials or internal IDs). */
export interface ExportedConnection {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  folder?: string;
  colorTag?: string;
  startupCommand?: string;
}

export interface ConnectionHistory {
  id: string;
  connectionId: string;
  connectedAt: number;
  disconnectedAt?: number;
  durationSecs?: number;
  error?: string;
}
