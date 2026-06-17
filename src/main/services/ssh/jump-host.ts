import { LIMITS } from '@shared/constants';
import type { ManualJumpHostConfig } from '@shared/types/connection';
import { Client, type ClientChannel } from 'ssh2';
import { describeSshError } from '../../lib/error-map';
import log from '../../lib/logger';
import { TimeoutError, withTimeout } from '../../lib/with-timeout';
import { type ConnectionRow, getDatabase, getSetting } from '../database';
import type { PendingHostKeyRegistry } from './host-key-flow';
import { buildConnectConfig } from './ssh-config';

export interface OpenJumpChannelParams {
  /** Connection id of the bastion row in the `connections` table. */
  jumpConnectionId?: string;
  /** Manual jump host configuration. */
  jumpHostConfig?: ManualJumpHostConfig;
  /** Final destination host (as seen *from the bastion*). */
  targetHost: string;
  /** Final destination port. */
  targetPort: number;
  /** Shared host-key TOFU registry from the SshManager. */
  pendingHostKeys: PendingHostKeyRegistry;
  /** Session id of the target session — propagated for host-key dialog routing. */
  sessionId?: string;
}

export interface JumpChannel {
  /** Duplex stream to hand to `connectConfig.sock` for the target client. */
  sock: ClientChannel;
  /** Tears down the bastion client. Idempotent. */
  dispose: () => void;
}

/**
 * Open an SSH session to the configured jump host (bastion) and request a
 * `direct-tcpip` channel forwarded from it to `targetHost:targetPort`.
 *
 * Lifecycle: the bastion client lives only as long as the returned channel
 * is in use. Callers MUST invoke `dispose()` when the target session ends
 * (success, failure, or disconnect) — otherwise the bastion Client leaks
 * its socket + keepalive timer.
 *
 * Errors are surfaced as the bastion's friendly description plus a
 * "Failed to open jump host channel via <name>" prefix so the user can
 * distinguish a bastion failure from a target failure in the UI.
 */
export async function openJumpChannel(params: OpenJumpChannelParams): Promise<JumpChannel> {
  const { jumpConnectionId, jumpHostConfig, targetHost, targetPort, pendingHostKeys, sessionId } =
    params;
  let config: import('ssh2').ConnectConfig;
  let bastionLabel: string;

  if (jumpConnectionId) {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT name, provider, host, port, username, auth_type, private_key_path,
                jump_host_connection_id
         FROM connections WHERE id = ?`,
      )
      .get(jumpConnectionId) as
      | Pick<
          ConnectionRow,
          | 'name'
          | 'provider'
          | 'host'
          | 'port'
          | 'username'
          | 'auth_type'
          | 'private_key_path'
          | 'jump_host_connection_id'
        >
      | undefined;
    if (!row) {
      throw new Error('Jump host connection not found');
    }
    if (row.provider !== 'sftp') {
      throw new Error('Jump host must be an SSH/SFTP connection');
    }
    if (!row.host || !row.username || !row.auth_type || row.port == null) {
      throw new Error('Jump host connection is missing required fields');
    }
    if (row.jump_host_connection_id) {
      throw new Error('Multi-hop jump host chains are not supported');
    }

    bastionLabel = row.name;

    const { config: builtConfig, error: configError } = await buildConnectConfig(
      {
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type as import('@shared/types/connection').AuthType,
        privateKeyPath: row.private_key_path,
      },
      { pendingHostKeys, connectionId: jumpConnectionId, sessionId },
    );
    if (configError || !builtConfig)
      throw new Error(`Config error for "${bastionLabel}": ${configError}`);
    config = builtConfig;
  } else if (jumpHostConfig) {
    bastionLabel = jumpHostConfig.host;
    // Manual jump host credentials are stored with a "jumphost:" prefix if
    // they are associated with a connectionId. But openJumpChannel doesn't
    // always have a connectionId context here?
    // Wait, params.sessionId is passed.
    // Actually, manual jump host settings for a connection are saved in the
    // database for that connection.
    // If we are testing a connection, we might have the password in jumpHostConfig.

    const password = jumpHostConfig.password;
    const passphrase = jumpHostConfig.passphrase;

    // If we have a sessionId, we can try to find the connectionId to retrieve credentials.
    // But it's easier if we pass connectionId to openJumpChannel.
    // For now, let's assume if it's manual, we might need to retrieve it.

    const { config: builtConfig, error: configError } = await buildConnectConfig(
      {
        host: jumpHostConfig.host,
        port: jumpHostConfig.port,
        username: jumpHostConfig.username,
        authType: jumpHostConfig.authType,
        privateKeyPath: jumpHostConfig.privateKeyPath,
        password,
        passphrase,
      },
      { pendingHostKeys, sessionId },
    );
    if (configError || !builtConfig)
      throw new Error(`Config error for "${bastionLabel}": ${configError}`);
    config = builtConfig;
  } else {
    throw new Error('No jump host configuration provided');
  }

  const wrap = (reason: string): Error =>
    new Error(`Failed to open jump host channel via "${bastionLabel}": ${reason}`);

  const client = new Client();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      client.removeAllListeners();
      client.end();
      client.destroy();
    } catch (err) {
      log.warn(`[SSH] Failed to dispose jump-host client for ${jumpConnectionId}:`, err);
    }
  };

  // Phase 1: wait for the bastion to reach `ready`.
  const readyPromise = new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (err) => reject(wrap(describeSshError(err))));
    // 'close' before 'ready' usually means the server cut the socket during
    // handshake — surface as a distinct, actionable reason.
    client.once('close', () => reject(wrap('connection closed before handshake completed')));
    try {
      client.connect(config);
    } catch (err) {
      reject(wrap(err instanceof Error ? err.message : String(err)));
    }
  });

  const timeoutMs = getSetting('ssh.connectTimeoutMs', LIMITS.SSH_CONNECT_TIMEOUT_MS);
  try {
    await withTimeout(readyPromise, timeoutMs, `jump-host.ready(${jumpConnectionId})`);
  } catch (err) {
    dispose();
    if (err instanceof TimeoutError) {
      throw wrap(`bastion handshake timed out after ${timeoutMs}ms`);
    }
    throw err;
  }

  // Phase 2: open a forwarded TCP channel from bastion → target.
  // ssh2's forwardOut signature: (srcIP, srcPort, dstIP, dstPort, callback).
  // srcIP/srcPort are advisory — the server logs them but they don't affect
  // routing. 127.0.0.1:0 mirrors what OpenSSH ProxyJump sends.
  return new Promise<JumpChannel>((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, channel) => {
      if (err) {
        dispose();
        reject(wrap(describeSshError(err)));
        return;
      }
      // If the bastion drops while the target session is still open, we want
      // the target to see a socket close (and reconnect). The channel will
      // naturally emit 'close' when the bastion goes away, so no explicit
      // wiring needed here.
      resolve({ sock: channel, dispose });
    });
  });
}
