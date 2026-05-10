import { readFile } from 'fs/promises';
import type { ConnectConfig } from 'ssh2';
import type { AuthType } from '@shared/types/connection';
import { IPC } from '@shared/constants';
import { emitToRenderer } from '../emit';
import { fingerprintKey, getStoredHostKey, verifyHostKey } from '../host-key-store';
import { getSetting } from '../database';
import { retrieveCredential } from '../credential-store';
import { expandAndConfineToHome } from '../../lib/validate';
import log from '../../lib/logger';
import { parseHostKeyAlgorithm, type PendingHostKeyRegistry } from './host-key-flow';

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  password?: string;
  passphrase?: string;
}

export interface BuildConfigOptions {
  /** Registry that captures candidate keys awaiting user trust. */
  pendingHostKeys: PendingHostKeyRegistry;
  /** Stable id for the connection row, used for emit metadata + credential lookup. */
  connectionId?: string;
  /** Stable id for the open session, used for emit metadata. */
  sessionId?: string;
}

/**
 * Build an ssh2 `ConnectConfig` from raw user input + the host-key trust
 * machinery. Pulled out of `SshManager` so `connect()` and `testConnection()`
 * share the same auth + verifier logic without sharing private state.
 *
 * Returns `{config}` on success, or `{config, error}` if private-key read
 * failed — the partial `config` is returned so callers can still introspect
 * what was attempted.
 */
export async function buildConnectConfig(
  params: ConnectParams,
  opts: BuildConfigOptions,
): Promise<{ config: ConnectConfig; error?: string }> {
  const { pendingHostKeys, connectionId, sessionId } = opts;

  const config: ConnectConfig = {
    host: params.host,
    port: params.port,
    username: params.username,
    keepaliveInterval: getSetting('ssh.keepAliveInterval', 10000),
    keepaliveCountMax: 3,
    readyTimeout: getSetting('ssh.readyTimeout', 30000),
    hostVerifier: (key: Buffer) => {
      const algorithm = parseHostKeyAlgorithm(key);
      const result = verifyHostKey(params.host, params.port, key, algorithm);
      if (result.weakAlgorithm) {
        // Don't prompt the user — refusing weak algorithms is a hard policy.
        emitToRenderer(IPC.SSH_ON_ERROR, {
          sessionId: sessionId ?? '',
          error: `Refusing weak host-key algorithm "${algorithm}". The server should be reconfigured to advertise ed25519, ecdsa, or rsa-sha2-* host keys.`,
        });
        return false;
      }
      if (!result.trusted) {
        const stored = getStoredHostKey(params.host, params.port);
        pendingHostKeys.remember(params.host, params.port, key, algorithm);
        emitToRenderer(IPC.SSH_ON_HOST_KEY_CHANGE, {
          sessionId: sessionId ?? '',
          connectionId: connectionId ?? '',
          host: params.host,
          port: params.port,
          storedFingerprint: stored?.fingerprint ?? '',
          newFingerprint: fingerprintKey(key),
          algorithm,
          isFirst: result.isFirst,
        });
        const reason = result.isFirst
          ? `Unknown host ${params.host}:${params.port}. Verify the ${algorithm} fingerprint before trusting.`
          : `Host key for ${params.host}:${params.port} has changed. Confirm the new fingerprint before reconnecting.`;
        emitToRenderer(IPC.SSH_ON_ERROR, { sessionId: sessionId ?? '', error: reason });
      }
      return result.trusted;
    },
  };

  // If a transient password/passphrase was supplied (test-connection on
  // unsaved settings), use it directly. Otherwise look up the saved
  // credential by connectionId.
  const password =
    params.password ?? (connectionId ? retrieveCredential(connectionId) : undefined);
  const passphrase =
    params.passphrase ?? (connectionId ? retrieveCredential(connectionId) : undefined);

  if (params.authType === 'password') {
    config.password = password || undefined;
    return { config };
  }

  if (params.authType === 'key' || params.authType === 'key+passphrase') {
    if (!params.privateKeyPath) {
      return { config, error: 'Private key path not configured' };
    }
    try {
      // Expand ~ via os.homedir() (not $HOME, which can be unset/empty and
      // collapse "~/.." into "/.."), and confine the real (symlink-resolved)
      // target to the home directory.
      const keyPath = await expandAndConfineToHome(params.privateKeyPath, 'privateKeyPath', {
        requireExists: true,
      });
      config.privateKey = await readFile(keyPath);
      if (params.authType === 'key+passphrase' && passphrase) {
        config.passphrase = passphrase;
      }
    } catch (err: unknown) {
      // Log underlying details, but surface only a generic message — fs
      // error strings include the absolute key path which we never want
      // to leak across IPC.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      log.warn(`[SSH] Failed to read private key (${code ?? 'unknown'})`);
      const message = err instanceof Error ? err.message : '';
      const reason =
        code === 'ENOENT'
          ? 'Private key file not found'
          : code === 'EACCES'
            ? 'Permission denied reading private key'
            : message.includes('home directory')
              ? 'Private key path must be inside the home directory'
              : 'Failed to read private key';
      return { config, error: reason };
    }
  }

  return { config };
}
