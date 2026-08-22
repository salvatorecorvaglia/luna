import type { AuthType, Connection, PortForwardingConfig } from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import { useCallback, useMemo, useState } from 'react';

/**
 * State shapes for the connection form, grouped by panel.
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
  keepaliveInterval: string;
  keepaliveCountMax: string;
  portForwards: PortForwardingConfig[];
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
  keepaliveInterval: '10',
  keepaliveCountMax: '3',
  portForwards: [],
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
  s3: S3State;
  patchCommon: Patch<CommonState>;
  patchSftp: Patch<SftpState>;
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
  /** Per-field validation messages, keyed by field name (excludes name-uniqueness). */
  fieldErrors: Record<string, string>;
}

export interface UseConnectionFormStateOptions {
  /** Credentials are only required on create; blank means "keep existing" on edit. */
  isEditing: boolean;
  /** Result of the async private-key file probe, surfaced as a field error when set. */
  privateKeyProbeError?: string;
}

export function useConnectionFormState(
  initialColor: string,
  { isEditing, privateKeyProbeError }: UseConnectionFormStateOptions,
): UseConnectionFormStateApi {
  const [common, setCommon] = useState<CommonState>(() => defaultCommon(initialColor));
  const [sftp, setSftp] = useState<SftpState>(DEFAULT_SFTP);
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
        keepaliveInterval:
          source.keepaliveInterval !== undefined ? String(source.keepaliveInterval / 1000) : '10',
        keepaliveCountMax:
          source.keepaliveCountMax !== undefined ? String(source.keepaliveCountMax) : '3',
        portForwards: source.portForwards || [],
      });

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
    setS3((prev) => ({ ...prev, accessKeyId: '', secretAccessKey: '', sessionToken: '' }));
  }, []);

  // Per-field validation (no list walks) — recomputed on the cheap inputs.
  // Name uniqueness is excluded: it needs the full connections list, which
  // this hook doesn't have, so callers merge that in separately.
  const fieldErrors = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (common.provider === 'sftp') {
      if (!sftp.host.trim()) out.host = 'Host is required';
      const portNum = parseInt(sftp.port, 10);
      if (sftp.port.trim() === '' || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        out.port = 'Port must be between 1 and 65535';
      }
      if (!sftp.username.trim()) out.username = 'Username is required';
      if (sftp.authType === 'password' && !isEditing && !sftp.password.trim()) {
        out.password = 'Password is required';
      }
      if (
        (sftp.authType === 'key' || sftp.authType === 'key+passphrase') &&
        !sftp.privateKeyPath.trim()
      ) {
        out.privateKeyPath = 'Private key path is required';
      } else if (privateKeyProbeError) {
        out.privateKeyPath = privateKeyProbeError;
      }
    } else {
      // S3 — credentials only required on create. On edit, leaving them
      // blank means "keep existing" (mirrors the SSH password UX).
      if (s3.port.trim() !== '') {
        const portNum = parseInt(s3.port, 10);
        if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
          out.port = 'Port must be between 1 and 65535';
        }
      }
      if (!isEditing && !s3.accessKeyId.trim()) out.accessKeyId = 'Access Key ID is required';
      if (!isEditing && !s3.secretAccessKey.trim()) {
        out.secretAccessKey = 'Secret Access Key is required';
      }
    }
    return out;
  }, [common.provider, sftp, s3, isEditing, privateKeyProbeError]);

  return {
    common,
    sftp,
    s3,
    patchCommon,
    patchSftp,
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
    fieldErrors,
  };
}
