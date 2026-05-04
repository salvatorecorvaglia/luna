import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { IPC, LIMITS } from '@shared/constants';
import { emitToRenderer } from './emit';
import type { SessionStatus } from '@shared/types/terminal';
import type { AuthType } from '@shared/types/connection';
import { type ConnectionRow, getDatabase, getSetting } from './database';
import { retrieveCredential } from './credential-store';
import { fingerprintKey, getStoredHostKey, updateHostKey, verifyHostKey } from './host-key-store';
import { TimeoutError, withTimeout } from '../lib/with-timeout';
import log from '../lib/logger';

/**
 * Extract the SSH host-key algorithm from the wire-format key buffer.
 * SSH host keys are encoded as: uint32 length || algorithm-name-string || ...
 * Returns 'unknown' if the buffer is malformed.
 */
function parseHostKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) return 'unknown';
  const len = key.readUInt32BE(0);
  if (len === 0 || len > 64 || key.length < 4 + len) return 'unknown';
  return key.subarray(4, 4 + len).toString('ascii');
}

interface StreamListeners {
  onData: (data: Buffer) => void;
  onClose: () => void;
  onStderrData: (data: Buffer) => void;
}

interface SshSession {
  id: string;
  connectionId: string;
  client: Client;
  shell: ClientChannel | null;
  status: SessionStatus;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnecting: boolean;
  _streamListeners?: StreamListeners;
  historyId?: string;
  cols?: number;
  rows?: number;
}

class SshManager {
  private sessions = new Map<string, SshSession>();
  private onDisconnectCallbacks: ((sessionId: string) => void)[] = [];
  /** Guards per-session to prevent concurrent reconnect chains (B1 fix). */
  private reconnectLocks = new Set<string>();
  /** Candidate host keys captured during a rejected verification, awaiting user trust. */
  private pendingHostKeys = new Map<string, { key: Buffer; algorithm: string }>();
  /** Cap on pending host-key candidates (LRU) — prevents unbounded growth on repeated mismatches. */
  private static readonly PENDING_HOST_KEYS_MAX = 64;

  private rememberPendingHostKey(host: string, port: number, key: Buffer, algorithm: string): void {
    const k = `${host}:${port}`;
    // Refresh LRU order
    if (this.pendingHostKeys.has(k)) this.pendingHostKeys.delete(k);
    this.pendingHostKeys.set(k, { key: Buffer.from(key), algorithm });
    while (this.pendingHostKeys.size > SshManager.PENDING_HOST_KEYS_MAX) {
      const oldest = this.pendingHostKeys.keys().next().value;
      if (oldest === undefined) break;
      this.pendingHostKeys.delete(oldest);
    }
  }

  /**
   * Trust a captured host key so the next connect succeeds.
   * Returns the fingerprint that was stored, or null if no candidate is pending.
   */
  trustPendingHostKey(host: string, port: number): string | null {
    const key = `${host}:${port}`;
    const pending = this.pendingHostKeys.get(key);
    if (!pending) return null;
    updateHostKey(host, port, pending.key, pending.algorithm);
    this.pendingHostKeys.delete(key);
    return fingerprintKey(pending.key);
  }

  /** Register a callback invoked when a session disconnects or begins reconnecting. */
  onSessionDisconnect(cb: (sessionId: string) => void): void {
    this.onDisconnectCallbacks.push(cb);
  }

  private setStatus(session: SshSession, status: SessionStatus): void {
    session.status = status;
    emitToRenderer(IPC.SSH_ON_STATUS, {
      sessionId: session.id,
      status,
    });
  }

  /**
   * Build a ConnectConfig from raw parameters. Extracted so both
   * `connect()` and `testConnection()` share the same auth + hostVerifier logic.
   */
  private async buildConnectConfig(
    params: {
      host: string;
      port: number;
      username: string;
      authType: AuthType;
      privateKeyPath?: string | null;
      password?: string;
      passphrase?: string;
    },
    connectionId?: string,
    sessionId?: string,
  ): Promise<{ config: ConnectConfig; error?: string }> {
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
        if (!result.trusted) {
          const stored = getStoredHostKey(params.host, params.port);
          this.rememberPendingHostKey(params.host, params.port, key, algorithm);
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

    // Set up auth
    // If we have a password/passphrase in params, use them directly (testing unsaved)
    // Otherwise try to retrieve from store if we have a connectionId
    const password = params.password ?? (connectionId ? retrieveCredential(connectionId) : undefined);
    const passphrase =
      params.passphrase ?? (connectionId ? retrieveCredential(connectionId) : undefined);

    if (params.authType === 'password') {
      config.password = password || undefined;
    } else if (params.authType === 'key' || params.authType === 'key+passphrase') {
      if (!params.privateKeyPath) {
        return { config, error: 'Private key path not configured' };
      }
      try {
        const keyPath = params.privateKeyPath.replace(/^~/, process.env.HOME || '');
        config.privateKey = await readFile(keyPath);
        if (params.authType === 'key+passphrase' && passphrase) {
          config.passphrase = passphrase;
        }
      } catch (err: unknown) {
        return {
          config,
          error: `Failed to read key: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { config };
  }

  async connect(
    sessionId: string,
    connectionId: string,
    cols = 80,
    rows = 24,
  ): Promise<{ success: boolean; error?: string }> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(connectionId) as
      | ConnectionRow
      | undefined;
    if (!row) {
      return { success: false, error: 'Connection not found' };
    }

    const client = new Client();

    const session: SshSession = {
      id: sessionId,
      connectionId,
      client,
      shell: null,
      status: 'connecting',
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnecting: false,
      cols,
      rows,
    };

    this.sessions.set(sessionId, session);
    this.setStatus(session, 'connecting');

    const { config: connectConfig, error: configError } = await this.buildConnectConfig(
      {
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        privateKeyPath: row.private_key_path,
      },
      connectionId,
      sessionId,
    );
    if (configError) {
      this.sessions.delete(sessionId);
      return { success: false, error: configError };
    }

    const connectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      client.on('ready', () => {
        session.reconnectAttempts = 0;
        this.setStatus(session, 'connected');

        // Update last_connected_at and record history. Wrap in try/catch so a DB error
        // doesn't hang the connection promise before resolve() or client.shell().
        try {
          db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(
            Math.floor(Date.now() / 1000),
            connectionId,
          );

          const historyId = uuidv4();
          session.historyId = historyId;
          db.prepare('INSERT INTO connection_history (id, connection_id) VALUES (?, ?)').run(
            historyId,
            connectionId,
          );
        } catch (err) {
          log.warn(`[SSH] Failed to record connection info for ${connectionId}:`, err);
        }

        client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
          if (err) {
            // Clean up session on shell creation failure
            this.sessions.delete(sessionId);
            resolve({ success: false, error: err.message });
            return;
          }

          session.shell = stream;

          const onData = (data: Buffer) => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8'),
            });
          };

          const onClose = () => {
            this.handleDisconnect(sessionId);
          };

          const onStderrData = (data: Buffer) => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8'),
            });
          };

          stream.on('data', onData);
          stream.on('close', onClose);
          stream.stderr.on('data', onStderrData);

          // Store listener refs for cleanup
          session._streamListeners = { onData, onClose, onStderrData };

          resolve({ success: true });
        });
      });

      client.on('error', (err) => {
        emitToRenderer(IPC.SSH_ON_ERROR, {
          sessionId,
          error: err.message,
        });

        if (session.status === 'connecting') {
          this.sessions.delete(sessionId);
          resolve({ success: false, error: err.message });
        } else {
          this.handleDisconnect(sessionId);
        }
      });

      client.on('close', () => {
        if (session.status === 'connected') {
          this.handleDisconnect(sessionId);
        } else if (session.status === 'connecting') {
          // Handshake aborted or socket closed before ready
          this.sessions.delete(sessionId);
          resolve({ success: false, error: 'Connection closed during handshake' });
        }
      });

      client.connect(connectConfig);
    });

    const timeoutMs = getSetting('ssh.connectTimeoutMs', LIMITS.SSH_CONNECT_TIMEOUT_MS);
    try {
      return await withTimeout(connectPromise, timeoutMs, `ssh.connect(${sessionId})`);
    } catch (err: unknown) {
      try {
        client.destroy();
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId);
      const isTimeout = err instanceof TimeoutError;
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: isTimeout ? `Connection timed out after ${timeoutMs}ms` : message,
      };
    }
  }

  private cleanupStreamListeners(session: SshSession): void {
    if (session.shell && session._streamListeners) {
      const { onData, onClose, onStderrData } = session._streamListeners;
      session.shell.removeListener('data', onData);
      session.shell.removeListener('close', onClose);
      session.shell.stderr.removeListener('data', onStderrData);
      session._streamListeners = undefined;
    }
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.status === 'disconnected') return;

    this.cleanupStreamListeners(session);
    this.setStatus(session, 'disconnected');
    emitToRenderer(IPC.SSH_ON_CLOSE, { sessionId });

    // Notify listeners (e.g. SFTP cache cleanup)
    for (const cb of this.onDisconnectCallbacks) {
      cb(sessionId);
    }

    // Auto-reconnect
    this.attemptReconnect(sessionId);
  }

  private attemptReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Per-session lock prevents concurrent reconnect chains
    if (this.reconnectLocks.has(sessionId)) return;

    const maxAttempts = getSetting('ssh.maxReconnectAttempts', 5);
    if (session.reconnectAttempts >= maxAttempts) {
      session.reconnecting = false;
      this.reconnectLocks.delete(sessionId);
      this.setStatus(session, 'error');
      return;
    }

    this.reconnectLocks.add(sessionId);
    session.reconnecting = true;
    session.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts - 1), 30000);

    this.setStatus(session, 'reconnecting');

    session.reconnectTimer = setTimeout(async () => {
      const sess = this.sessions.get(sessionId);
      if (!sess || sess.status === 'connected') {
        if (sess) sess.reconnecting = false;
        this.reconnectLocks.delete(sessionId);
        return;
      }

      // Clean up old client and stream listeners
      this.cleanupStreamListeners(sess);
      try {
        sess.client.end();
      } catch (err) {
        log.error(`[SSH] Error ending client for reconnect ${sessionId}:`, err);
      }

      // Remove session, then reconnect (atomic: connect re-adds it)
      const connectionId = sess.connectionId;
      const reconnectAttempts = sess.reconnectAttempts;
      const cols = sess.cols;
      const rows = sess.rows;
      this.sessions.delete(sessionId);

      const result = await this.connect(sessionId, connectionId, cols, rows);

      // Restore reconnect attempt count if connect failed so we don't loop forever
      if (!result.success) {
        const newSess = this.sessions.get(sessionId);
        if (newSess) {
          newSess.reconnectAttempts = reconnectAttempts;
          newSess.reconnecting = false;
        }
        // Release lock before next attempt
        this.reconnectLocks.delete(sessionId);
        this.attemptReconnect(sessionId);
      } else {
        const newSess = this.sessions.get(sessionId);
        if (newSess) newSess.reconnecting = false;
        this.reconnectLocks.delete(sessionId);
      }
    }, delay);
  }

  sendData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.shell?.writable) {
      session.shell.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cols = cols;
      session.rows = rows;
      if (session.shell) {
        session.shell.setWindow(rows, cols, rows * 16, cols * 8);
      }
    }
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }
    // Clear reconnect lock so no pending timer re-enters
    this.reconnectLocks.delete(sessionId);

    this.cleanupStreamListeners(session);

    try {
      session.shell?.close();
      session.client.end();
    } catch (err) {
      log.error(`[SSH] Error closing session ${sessionId}:`, err);
    }

    // Record disconnect in history
    if (session.historyId) {
      try {
        const db = getDatabase();
        const now = Math.floor(Date.now() / 1000);
        db.prepare(
          'UPDATE connection_history SET disconnected_at = ?, duration_secs = (? - connected_at) WHERE id = ?',
        ).run(now, now, session.historyId);
      } catch (err) {
        log.warn(`[SSH] Failed to record disconnect history for ${session.historyId}:`, err);
      }
    }

    session.status = 'disconnected';
    this.sessions.delete(sessionId);
    // Drop any host-key candidate associated with this connection's host (best-effort).
    try {
      const db = getDatabase();
      const row = db
        .prepare('SELECT host, port FROM connections WHERE id = ?')
        .get(session.connectionId) as { host: string; port: number } | undefined;
      if (row) this.pendingHostKeys.delete(`${row.host}:${row.port}`);
    } catch {
      // best-effort cleanup
    }
  }

  /**
   * Open a transient SSH connection to test settings.
   * Can be used with an existing connectionId or with raw configuration.
   */
  async testConnection(params: {
    connectionId?: string;
    config?: {
      host: string;
      port: number;
      username: string;
      authType: AuthType;
      privateKeyPath?: string;
      password?: string;
      passphrase?: string;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    let host: string, port: number, username: string, authType: AuthType;
    let privateKeyPath: string | undefined;
    let password: string | undefined;
    let passphrase: string | undefined;

    if (params.config) {
      host = params.config.host;
      port = params.config.port;
      username = params.config.username;
      authType = params.config.authType;
      privateKeyPath = params.config.privateKeyPath;
      password = params.config.password;
      passphrase = params.config.passphrase;
    } else if (params.connectionId) {
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(params.connectionId) as
        | ConnectionRow
        | undefined;
      if (!row) return { ok: false, error: 'Connection not found' };

      host = row.host;
      port = row.port;
      username = row.username;
      authType = row.auth_type;
      privateKeyPath = row.private_key_path || undefined;
    } else {
      return { ok: false, error: 'Invalid test parameters' };
    }

    const { config, error: configError } = await this.buildConnectConfig(
      { host, port, username, authType, privateKeyPath, password, passphrase },
      params.connectionId,
    );
    if (configError) return { ok: false, error: configError };

    return new Promise((resolve) => {
      const client = new Client();
      let settled = false;
      const finish = (result: { ok: boolean; error?: string }): void => {
        if (settled) return;
        settled = true;
        try {
          client.removeAllListeners();
          client.end();
          client.destroy();
        } catch {
          // ignore
        }
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: `Connection test timed out after ${LIMITS.SSH_CONNECT_TIMEOUT_MS}ms`,
          }),
        LIMITS.SSH_CONNECT_TIMEOUT_MS,
      );
      client.on('ready', () => {
        clearTimeout(timer);
        finish({ ok: true });
      });
      client.on('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: err.message });
      });
      try {
        client.connect(config);
      } catch (err: unknown) {
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  getSession(sessionId: string): SshSession | undefined {
    return this.sessions.get(sessionId);
  }

  disconnectAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.disconnect(sessionId);
    }
  }
}

export const sshManager = new SshManager();
