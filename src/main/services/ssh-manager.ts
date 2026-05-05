import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { IPC, LIMITS } from '@shared/constants';
import { emitToRenderer } from './emit';
import type { SessionStatus } from '@shared/types/terminal';
import type { AuthType } from '@shared/types/connection';
import { type ConnectionRow, getDatabase, getSetting } from './database';
import { retrieveCredential } from './credential-store';
import {
  fingerprintKey,
  formatHostKey,
  getStoredHostKey,
  updateHostKey,
  verifyHostKey,
} from './host-key-store';
import { TimeoutError, withTimeout } from '../lib/with-timeout';
import { describeSshError } from '../lib/error-map';
import { expandAndConfineToHome } from '../lib/validate';
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
  /**
   * Monotonically increasing token. Bumped by connect(), disconnect() and
   * every reconnect attempt. Pending timers capture the value at scheduling
   * time and bail out if the session generation has moved on (B1).
   */
  reconnectGen: number;
  _streamListeners?: StreamListeners;
  historyId?: string;
  cols?: number;
  rows?: number;
}

/** Maximum delay between reconnect attempts (ms). The backoff doubles up to this cap. */
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Base delay for the first reconnect attempt (ms). */
const RECONNECT_BASE_DELAY_MS = 1_000;

class SshManager {
  private sessions = new Map<string, SshSession>();
  private onDisconnectCallbacks: ((sessionId: string) => void)[] = [];
  /** Candidate host keys captured during a rejected verification, awaiting user trust. */
  private pendingHostKeys = new Map<string, { key: Buffer; algorithm: string }>();
  /** Cap on pending host-key candidates (LRU) — prevents unbounded growth on repeated mismatches. */
  private static readonly PENDING_HOST_KEYS_MAX = 64;

  private rememberPendingHostKey(host: string, port: number, key: Buffer, algorithm: string): void {
    const k = formatHostKey(host, port);
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
    const key = formatHostKey(host, port);
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
    const password =
      params.password ?? (connectionId ? retrieveCredential(connectionId) : undefined);
    const passphrase =
      params.passphrase ?? (connectionId ? retrieveCredential(connectionId) : undefined);

    if (params.authType === 'password') {
      config.password = password || undefined;
    } else if (params.authType === 'key' || params.authType === 'key+passphrase') {
      if (!params.privateKeyPath) {
        return { config, error: 'Private key path not configured' };
      }
      try {
        // Expand ~ via os.homedir() (not $HOME, which can be unset/empty and
        // collapse "~/.." into "/.."), and confine the real (symlink-resolved)
        // target to the home directory (S3).
        const keyPath = await expandAndConfineToHome(params.privateKeyPath, 'privateKeyPath', {
          requireExists: true,
        });
        config.privateKey = await readFile(keyPath);
        if (params.authType === 'key+passphrase' && passphrase) {
          config.passphrase = passphrase;
        }
      } catch (err: unknown) {
        // Log the underlying details for debugging, but only surface a generic
        // message to the renderer — fs error strings include the absolute key
        // path which we never want to leak through IPC (S1).
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

    // Preserve any in-flight reconnect generation so stale timers from a prior
    // session-with-the-same-id don't fire against this fresh client.
    const prevGen = this.sessions.get(sessionId)?.reconnectGen ?? 0;
    const session: SshSession = {
      id: sessionId,
      connectionId,
      client,
      shell: null,
      status: 'connecting',
      reconnectAttempts: 0,
      reconnectTimer: null,
      reconnecting: false,
      reconnectGen: prevGen + 1,
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
        const friendly = describeSshError(err);
        emitToRenderer(IPC.SSH_ON_ERROR, {
          sessionId,
          error: friendly,
        });

        if (session.status === 'connecting') {
          this.sessions.delete(sessionId);
          resolve({ success: false, error: friendly });
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

    // A pending timer means a reconnect is already scheduled — don't stack them.
    if (session.reconnectTimer) return;

    const maxAttempts = getSetting('ssh.maxReconnectAttempts', 5);
    if (session.reconnectAttempts >= maxAttempts) {
      session.reconnecting = false;
      this.setStatus(session, 'error');
      return;
    }

    session.reconnecting = true;
    session.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, session.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    this.setStatus(session, 'reconnecting');

    // Capture the generation so the timer body can detect "I'm stale".
    const gen = session.reconnectGen;
    session.reconnectTimer = setTimeout(async () => {
      const sess = this.sessions.get(sessionId);
      if (!sess || sess.reconnectGen !== gen) {
        // Either the session is gone or someone (manual disconnect/reconnect) bumped
        // the generation while we were waiting. Don't act on stale state.
        return;
      }
      sess.reconnectTimer = null;
      if (sess.status === 'connected') {
        sess.reconnecting = false;
        return;
      }

      this.cleanupStreamListeners(sess);
      try {
        sess.client.end();
      } catch (err) {
        log.error(`[SSH] Error ending client for reconnect ${sessionId}:`, err);
      }

      const connectionId = sess.connectionId;
      const reconnectAttempts = sess.reconnectAttempts;
      const cols = sess.cols;
      const rows = sess.rows;
      // connect() re-adds the session (and bumps reconnectGen).
      this.sessions.delete(sessionId);

      const result = await this.connect(sessionId, connectionId, cols, rows);

      if (!result.success) {
        const newSess = this.sessions.get(sessionId);
        if (newSess) {
          newSess.reconnectAttempts = reconnectAttempts;
          newSess.reconnecting = false;
        }
        this.attemptReconnect(sessionId);
      } else {
        const newSess = this.sessions.get(sessionId);
        if (newSess) newSess.reconnecting = false;
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
      session.reconnectTimer = null;
    }
    // Bump the generation so any timer that escaped the clear (already in the
    // task queue) sees stale state and bails.
    session.reconnectGen++;

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
      if (row) this.pendingHostKeys.delete(formatHostKey(row.host, row.port));
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
        finish({ ok: false, error: describeSshError(err) });
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
