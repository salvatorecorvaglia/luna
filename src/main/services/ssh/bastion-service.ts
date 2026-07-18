import { LIMITS } from '@shared/constants';
import type { ManualJumpHostConfig } from '@shared/types/connection';
import { Client, type ClientChannel } from 'ssh2';
import { describeSshError } from '../../lib/error-map';
import log from '../../lib/logger';
import { TimeoutError, withTimeout } from '../../lib/with-timeout';
import { retrieveCredential } from '../credential-store';
import { type ConnectionRow, getDatabase, getSetting } from '../database';
import type { PendingHostKeyRegistry } from './host-key-flow';
import { buildConnectConfig } from './ssh-config';

export interface OpenJumpChannelParams {
  /** Target connection id of the main row in the `connections` table. */
  connectionId?: string;
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

class BastionService {
  /**
   * Retrieve and attach credentials (password or key passphrase) to a manual
   * jump-host configuration from the secure store.
   */
  async resolveCredentials(connectionId: string, config: ManualJumpHostConfig): Promise<void> {
    const secret = retrieveCredential(`jumphost:${connectionId}`);
    if (secret) {
      if (config.authType === 'password') {
        config.password = secret;
      } else if (config.authType === 'key+passphrase') {
        config.passphrase = secret;
      }
    }
  }

  /**
   * Open an SSH session to the configured jump host (bastion) and request a
   * `direct-tcpip` channel forwarded from it to `targetHost:targetPort`.
   *
   * Lifecycle: the bastion client lives only as long as the returned channel
   * is in use. Callers MUST invoke `dispose()` when the target session ends
   * (success, failure, or disconnect) — otherwise the bastion Client leaks
   * its socket + keepalive timer.
   */
  async openChannel(params: OpenJumpChannelParams): Promise<JumpChannel> {
    const {
      connectionId,
      jumpConnectionId,
      jumpHostConfig,
      targetHost,
      targetPort,
      pendingHostKeys,
      sessionId,
    } = params;
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
      if (configError || !builtConfig) {
        throw new Error(`Config error for "${bastionLabel}": ${configError}`);
      }
      config = builtConfig;
    } else if (jumpHostConfig) {
      bastionLabel = jumpHostConfig.host;

      // Automatically resolve credentials if connectionId is provided
      if (connectionId) {
        await this.resolveCredentials(connectionId, jumpHostConfig);
      }

      const { config: builtConfig, error: configError } = await buildConnectConfig(
        {
          host: jumpHostConfig.host,
          port: jumpHostConfig.port,
          username: jumpHostConfig.username,
          authType: jumpHostConfig.authType,
          privateKeyPath: jumpHostConfig.privateKeyPath,
          password: jumpHostConfig.password,
          passphrase: jumpHostConfig.passphrase,
        },
        { pendingHostKeys, sessionId },
      );
      if (configError || !builtConfig) {
        throw new Error(`Config error for "${bastionLabel}": ${configError}`);
      }
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

    // Remove temporary handshake listeners
    client.removeAllListeners('ready');
    client.removeAllListeners('error');
    client.removeAllListeners('close');

    // Register a long-lived error handler to prevent uncaught exceptions crashing the process
    client.on('error', (err) => {
      log.error(`[SSH-Jump] Bastion connection error for "${bastionLabel}":`, err);
    });

    // Phase 2: open a forwarded TCP channel from bastion → target.
    return new Promise<JumpChannel>((resolve, reject) => {
      client.forwardOut('127.0.0.1', 0, targetHost, targetPort, (err, channel) => {
        if (err) {
          dispose();
          reject(wrap(describeSshError(err)));
          return;
        }
        resolve({ sock: channel, dispose });
      });
    });
  }
}

export const bastionService = new BastionService();
