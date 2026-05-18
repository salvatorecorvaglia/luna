import { useCallback, useState } from 'react';
import type { AuthType, Connection } from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';

/**
 * State shapes for the connection form, grouped by panel. The form previously
 * carried ~30 individual `useState` hooks; consolidating them into cohesive
 * objects collapses prop-drilling at the panel boundary (SftpFields,
 * S3Fields) from ~50 props to a state + onChange pair, and lets the reseed /
 * clearSecrets / reset paths operate on whole-record values instead of
 * dozens of setter calls.
 */
export interface SftpState {
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  showPassword: boolean;
}

export interface JumpHostState {
  mode: 'existing' | 'manual';
  connectionId: string;
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  showPassword: boolean;
}

export interface S3State {
  protocol: 'http' | 'https';
  host: string;
  port: string;
  region: string;
  defaultBucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  showSecretKey: boolean;
}

export interface CommonState {
  name: string;
  provider: StorageProviderKind;
  folder: string;
  colorTag: string;
  isHidden: boolean;
}

export type Patch<T> = (patch: Partial<T>) => void;

const DEFAULT_SFTP: SftpState = {
  host: '',
  port: '22',
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  showPassword: false,
};

const DEFAULT_JUMP_HOST: JumpHostState = {
  mode: 'existing',
  connectionId: '',
  host: '',
  port: '22',
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  showPassword: false,
};

const DEFAULT_S3: S3State = {
  protocol: 'https',
  host: '',
  port: '',
  region: '',
  defaultBucket: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  showSecretKey: false,
};

function defaultCommon(initialColor: string): CommonState {
  return {
    name: '',
    provider: 'sftp',
    folder: 'default',
    colorTag: initialColor,
    isHidden: false,
  };
}

export interface UseConnectionFormStateApi {
  common: CommonState;
  sftp: SftpState;
  jumpHost: JumpHostState;
  s3: S3State;
  patchCommon: Patch<CommonState>;
  patchSftp: Patch<SftpState>;
  patchJumpHost: Patch<JumpHostState>;
  patchS3: Patch<S3State>;
  touched: Record<string, boolean>;
  markTouched(field: string): void;
  setTouched(next: Record<string, boolean>): void;
  dirty: boolean;
  markDirty(): void;
  setDirty(value: boolean): void;
  /** Reset every group to its default. */
  resetForm(): void;
  /**
   * Reseed from a remote-loaded connection (edit/duplicate). Secrets are
   * intentionally left blank — only stored ciphertext exists for those, and
   * blank fields mean "keep existing" on the update path.
   */
  reseedFromConnection(source: Connection, opts: { isDuplicate: boolean }): void;
  /** Wipe transient cleartext secrets from React state. */
  clearSecrets(): void;
}

export function useConnectionFormState(initialColor: string): UseConnectionFormStateApi {
  const [common, setCommon] = useState<CommonState>(() => defaultCommon(initialColor));
  const [sftp, setSftp] = useState<SftpState>(DEFAULT_SFTP);
  const [jumpHost, setJumpHost] = useState<JumpHostState>(DEFAULT_JUMP_HOST);
  const [s3, setS3] = useState<S3State>(DEFAULT_S3);
  const [touched, setTouchedState] = useState<Record<string, boolean>>({});
  const [dirty, setDirtyState] = useState(false);

  const patchCommon = useCallback<Patch<CommonState>>(
    (p) => setCommon((prev) => ({ ...prev, ...p })),
    [],
  );
  const patchSftp = useCallback<Patch<SftpState>>(
    (p) => setSftp((prev) => ({ ...prev, ...p })),
    [],
  );
  const patchJumpHost = useCallback<Patch<JumpHostState>>(
    (p) => setJumpHost((prev) => ({ ...prev, ...p })),
    [],
  );
  const patchS3 = useCallback<Patch<S3State>>((p) => setS3((prev) => ({ ...prev, ...p })), []);

  const markTouched = useCallback((field: string) => {
    setTouchedState((prev) => ({ ...prev, [field]: true }));
  }, []);

  const setTouched = useCallback((next: Record<string, boolean>) => {
    setTouchedState(next);
  }, []);

  const markDirty = useCallback(() => setDirtyState(true), []);
  const setDirty = useCallback((value: boolean) => setDirtyState(value), []);

  const resetForm = useCallback(() => {
    setCommon(defaultCommon(initialColor));
    setSftp(DEFAULT_SFTP);
    setJumpHost(DEFAULT_JUMP_HOST);
    setS3(DEFAULT_S3);
    setTouchedState({});
  }, [initialColor]);

  const reseedFromConnection = useCallback<UseConnectionFormStateApi['reseedFromConnection']>(
    (source, { isDuplicate }) => {
      setCommon({
        name: isDuplicate ? `${source.name} (copy)` : source.name,
        provider: source.provider ?? 'sftp',
        folder: source.folder,
        colorTag: source.colorTag || initialColor,
        isHidden: source.isHidden ?? false,
      });
      setSftp({
        host: source.host,
        port: String(source.port),
        username: source.username,
        authType: source.authType,
        password: '',
        privateKeyPath: source.privateKeyPath || '',
        passphrase: '',
        showPassword: false,
      });
      if (source.jumpHostConfig) {
        setJumpHost({
          mode: 'manual',
          connectionId: source.jumpHostConnectionId || '',
          host: source.jumpHostConfig.host,
          port: String(source.jumpHostConfig.port),
          username: source.jumpHostConfig.username,
          authType: source.jumpHostConfig.authType,
          password: '',
          privateKeyPath: source.jumpHostConfig.privateKeyPath || '',
          passphrase: '',
          showPassword: false,
        });
      } else {
        setJumpHost({
          ...DEFAULT_JUMP_HOST,
          connectionId: source.jumpHostConnectionId || '',
        });
      }

      let protocol: 'http' | 'https' = 'https';
      let host = '';
      let port = '';
      if (source.endpoint) {
        try {
          const url = new URL(source.endpoint);
          protocol = url.protocol === 'http:' ? 'http' : 'https';
          host = url.hostname;
          port = url.port;
        } catch {
          const match = source.endpoint.match(/^(https?):\/\/(.+)$/i);
          if (match) {
            protocol = match[1].toLowerCase() === 'http' ? 'http' : 'https';
            const rest = match[2];
            const colon = rest.indexOf(':');
            if (colon !== -1) {
              host = rest.slice(0, colon);
              port = rest.slice(colon + 1);
            } else {
              host = rest;
            }
          } else {
            const colon = source.endpoint.indexOf(':');
            if (colon !== -1) {
              host = source.endpoint.slice(0, colon);
              port = source.endpoint.slice(colon + 1);
            } else {
              host = source.endpoint;
            }
          }
        }
      }

      setS3({
        protocol,
        host,
        port,
        region: source.region || '',
        defaultBucket: source.defaultBucket || '',
        forcePathStyle: source.forcePathStyle ?? false,
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: '',
        showSecretKey: false,
      });
      setTouchedState({});
    },
    [initialColor],
  );

  const clearSecrets = useCallback(() => {
    setSftp((prev) => ({ ...prev, password: '', passphrase: '' }));
    setJumpHost((prev) => ({ ...prev, password: '', passphrase: '' }));
    setS3((prev) => ({ ...prev, accessKeyId: '', secretAccessKey: '', sessionToken: '' }));
  }, []);

  return {
    common,
    sftp,
    jumpHost,
    s3,
    patchCommon,
    patchSftp,
    patchJumpHost,
    patchS3,
    touched,
    markTouched,
    setTouched,
    dirty,
    markDirty,
    setDirty,
    resetForm,
    reseedFromConnection,
    clearSecrets,
  };
}
