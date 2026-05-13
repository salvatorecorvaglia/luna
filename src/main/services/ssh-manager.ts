import { Client, type ClientChannel } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { IPC, LIMITS } from '@shared/constants';
import { emitToRenderer } from './emit';
import type { SessionStatus } from '@shared/types/terminal';
import type { AuthType } from '@shared/types/connection';
import { type ConnectionRow, getDatabase, getSetting } from './database';
import { PendingHostKeyRegistry } from './ssh/host-key-flow';
import { buildConnectConfig } from './ssh/ssh-config';
import { openJumpChannel } from './ssh/jump-host';
import { TimeoutError, withTimeout } from '../lib/with-timeout';
import { describeSshError } from '../lib/error-map';
import log from '../lib/logger';

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
   * time and bail out if the session generation has moved on.
   */
  reconnectGen: number;
  _streamListeners?: StreamListeners;
  historyId?: string;
  cols?: number;
  rows?: number;
  /**
   * Tear-down hook for an associated jump-host (bastion) client. When the
   * target session connects via ProxyJump, the underlying bastion `Client`
   * lives alongside this session and must be ended when the session ends.
   * Idempotent — safe to call from both error paths and `disconnect()`.
   */
  jumpDispose?: () => void;
}

/** Maximum delay between reconnect attempts (ms). The backoff doubles up to this cap. */
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Base delay for the first reconnect attempt (ms). */
const RECONNECT_BASE_DELAY_MS = 1_000;

class SshManager {
  private sessions = new Map<string, SshSession>();
  private onDisconnectCallbacks: ((sessionId: string) => void)[] = [];
  private onConnectCallbacks: ((sessionId: string) => void)[] = [];
  /** Candidate host keys captured during a rejected verification, awaiting user trust. */
  private pendingHostKeys = new PendingHostKeyRegistry();

  /**
   * Trust a captured host key so the next connect succeeds.
   * Returns the fingerprint that was stored, or null if no candidate is pending.
   */
  trustPendingHostKey(host: string, port: number): string | null {
    return this.pendingHostKeys.trust(host, port);
  }

  /**
   * Register a callback invoked when a session disconnects or begins reconnecting.
   * Returns an unsubscribe function so callers can clean up explicitly. The
   * registry de-duplicates the same callback reference — the previous
   * push-only design grew unboundedly across hot-reloads in dev and would
   * fire a single disconnect into the same listener N times.
   */
  onSessionDisconnect(cb: (sessionId: string) => void): () => void {
    if (!this.onDisconnectCallbacks.includes(cb)) {
      this.onDisconnectCallbacks.push(cb);
    }
    return () => {
      const idx = this.onDisconnectCallbacks.indexOf(cb);
      if (idx !== -1) this.onDisconnectCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register a callback fired on every successful (re)connect. Used by the IPC
   * layer to (re-)register the SFTP storage provider so the storage registry
   * stays consistent across automatic reconnects — without this, a reconnect
   * would leave the registry pointing at the original session lifecycle while
   * `getSession` returns the freshly minted ssh2 Client.
   */
  onSessionConnect(cb: (sessionId: string) => void): () => void {
    if (!this.onConnectCallbacks.includes(cb)) {
      this.onConnectCallbacks.push(cb);
    }
    return () => {
      const idx = this.onConnectCallbacks.indexOf(cb);
      if (idx !== -1) this.onConnectCallbacks.splice(idx, 1);
    };
  }

  private setStatus(session: SshSession, status: SessionStatus): void {
    session.status = status;
    emitToRenderer(IPC.SSH_ON_STATUS, {
      sessionId: session.id,
      status,
    });
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
    if (row.provider !== 'sftp') {
      return { success: false, error: `Connection ${connectionId} is not an SSH connection` };
    }
    if (!row.host || !row.username || !row.auth_type || row.port == null) {
      return { success: false, error: 'SSH connection is missing required fields' };
    }

    const client = new Client();

    // Preserve any in-flight reconnect generation so stale timers from a prior
    // session-with-the-same-id don't fire against this fresh client.
    const existing = this.sessions.get(sessionId);
    const prevGen = existing?.reconnectGen ?? 0;

    if (existing) {
      // The internal reconnect path calls client.end() + sessions.delete()
      // before reaching connect(), so this branch only fires when a renderer
      // invokes ssh.connect twice for the same sessionId. Without the cleanup
      // the prior Client's socket + handshake listeners stay alive past the
      // overwrite below and a 'close' event on the abandoned client would
      // call handleDisconnect() against the new session entry.
      this.cleanupStreamListeners(existing);
      if (existing.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      try {
        // Drop listeners before destroying so the synthetic 'close'/'error'
        // from teardown can't reach the soon-to-be-replaced session entry.
        existing.client.removeAllListeners();
        existing.shell?.close();
        existing.client.destroy();
      } catch (err) {
        log.warn(`[SSH] Failed to clean up prior client for ${sessionId}:`, err);
      }
    }

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

    // Open the jump-host channel *before* building the target config so a
    // bastion failure short-circuits without spinning up a target Client.
    // The resulting Duplex becomes the target's `sock`.
    let jumpSock: import('stream').Duplex | undefined;
    if (row.jump_host_connection_id || row.jump_host_host) {
      try {
        let manualConfig: import('@shared/types/connection').ManualJumpHostConfig | undefined;
        if (
          row.jump_host_host &&
          row.jump_host_username &&
          row.jump_host_auth_type &&
          row.jump_host_port
        ) {
          manualConfig = {
            host: row.jump_host_host,
            port: row.jump_host_port,
            username: row.jump_host_username,
            authType: row.jump_host_auth_type as import('@shared/types/connection').AuthType,
            privateKeyPath: row.jump_host_private_key_path || undefined,
          };
          await this.resolveJumpHostCredentials(connectionId, manualConfig);
        }

        const channel = await openJumpChannel({
          jumpConnectionId: row.jump_host_connection_id || undefined,
          jumpHostConfig: manualConfig,
          targetHost: row.host,
          targetPort: row.port,
          pendingHostKeys: this.pendingHostKeys,
          sessionId,
        });
        jumpSock = channel.sock;
        session.jumpDispose = channel.dispose;
      } catch (err) {
        this.sessions.delete(sessionId);
        const message = err instanceof Error ? err.message : String(err);
        emitToRenderer(IPC.SSH_ON_ERROR, { sessionId, error: message });
        return { success: false, error: message };
      }
    }

    const { config: connectConfig, error: configError } = await buildConnectConfig(
      {
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        privateKeyPath: row.private_key_path,
      },
      { pendingHostKeys: this.pendingHostKeys, connectionId, sessionId, sock: jumpSock },
    );
    if (configError) {
      session.jumpDispose?.();
      this.sessions.delete(sessionId);
      return { success: false, error: configError };
    }

    // Track handshake-phase listeners so they can be unwired before we
    // either resolve (and hand off to the post-handshake listeners) or
    // destroy the client. Without this, every failed/timed-out connect leaks
    // 'ready'/'error'/'close' listeners on a Client that's about to be GC'd
    // but may still emit before its sockets close.
    let handshakeSettled = false;
    let onReady: () => void = () => {};
    let onError: (err: Error) => void = () => {};
    let onClose: () => void = () => {};
    const removeHandshakeListeners = (): void => {
      client.off('ready', onReady);
      client.off('error', onError);
      client.off('close', onClose);
    };

    const connectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const settle = (result: { success: boolean; error?: string }): void => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        removeHandshakeListeners();
        resolve(result);
      };

      onReady = (): void => {
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
            session.jumpDispose?.();
            this.sessions.delete(sessionId);
            settle({ success: false, error: err.message });
            return;
          }

          session.shell = stream;

          const onData = (data: Buffer): void => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8'),
            });
          };

          const onShellClose = (): void => {
            this.handleDisconnect(sessionId);
          };

          const onStderrData = (data: Buffer): void => {
            emitToRenderer(IPC.SSH_ON_DATA, {
              sessionId,
              data: data.toString('utf-8'),
            });
          };

          stream.on('data', onData);
          stream.on('close', onShellClose);
          stream.stderr.on('data', onStderrData);

          // Store listener refs for cleanup
          session._streamListeners = { onData, onClose: onShellClose, onStderrData };

          // Hand off lifecycle responsibilities from the handshake-only listeners
          // to the long-lived ones below. These survive until disconnect().
          for (const cb of this.onConnectCallbacks) {
            try {
              cb(sessionId);
            } catch (cbErr) {
              log.warn(`[SSH] onConnect callback threw for ${sessionId}:`, cbErr);
            }
          }

          settle({ success: true });

          client.on('error', (err) => {
            const friendly = describeSshError(err);
            emitToRenderer(IPC.SSH_ON_ERROR, { sessionId, error: friendly });
            this.handleDisconnect(sessionId);
          });
          client.on('close', () => {
            if (session.status === 'connected') this.handleDisconnect(sessionId);
          });
        });
      };

      onError = (err: Error): void => {
        const friendly = describeSshError(err);
        emitToRenderer(IPC.SSH_ON_ERROR, { sessionId, error: friendly });
        session.jumpDispose?.();
        this.sessions.delete(sessionId);
        settle({ success: false, error: friendly });
      };

      onClose = (): void => {
        // Handshake aborted or socket closed before ready
        session.jumpDispose?.();
        this.sessions.delete(sessionId);
        settle({ success: false, error: 'Connection closed during handshake' });
      };

      client.once('ready', onReady);
      client.once('error', onError);
      client.once('close', onClose);

      client.connect(connectConfig);
    });

    const timeoutMs = getSetting('ssh.connectTimeoutMs', LIMITS.SSH_CONNECT_TIMEOUT_MS);
    try {
      return await withTimeout(connectPromise, timeoutMs, `ssh.connect(${sessionId})`);
    } catch (err: unknown) {
      // Make sure the handshake-phase listeners are gone before we destroy(),
      // otherwise the synthetic 'close' from destroy() can fire 'error'/'close'
      // again into the (already-rejected) promise pathway.
      if (!handshakeSettled) {
        handshakeSettled = true;
        removeHandshakeListeners();
      }
      try {
        client.destroy();
      } catch {
        // ignore
      }
      session.jumpDispose?.();
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
    // The bastion socket is no longer carrying any useful traffic once the
    // target session is down; releasing it here keeps a transient failure
    // from leaking a bastion Client across an auto-reconnect cycle (the
    // next attempt re-opens the channel from scratch).
    session.jumpDispose?.();
    session.jumpDispose = undefined;
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

      // Connect() should always resolve with {success}, but treat a thrown
      // error the same as a failed reconnect so a bug here can't escape as an
      // unhandled rejection inside a setTimeout callback.
      let result: { success: boolean; error?: string };
      try {
        result = await this.connect(sessionId, connectionId, cols, rows);
      } catch (err) {
        log.error(`[SSH] Reconnect threw for ${sessionId}:`, err);
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }

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
    // Idempotent: a double-disconnect (e.g. user clicked Close while a
    // 'close' event from ssh2 was already in flight) would otherwise double-
    // write the history row and call client.end() twice.
    if (session.status === 'disconnected') return;

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
    // Tear down the bastion client (if any) after the target client so a
    // graceful 'end' has a chance to drain through the forwarded channel.
    session.jumpDispose?.();

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
      if (row) this.pendingHostKeys.forget(row.host, row.port);
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
      jumpHostConnectionId?: string;
      jumpHostConfig?: import('@shared/types/connection').ManualJumpHostConfig;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    let host: string, port: number, username: string, authType: AuthType;
    let privateKeyPath: string | undefined;
    let password: string | undefined;
    let passphrase: string | undefined;
    let jumpHostConnectionId: string | undefined;
    let jumpHostConfig: import('@shared/types/connection').ManualJumpHostConfig | undefined;

    if (params.config) {
      host = params.config.host;
      port = params.config.port;
      username = params.config.username;
      authType = params.config.authType;
      privateKeyPath = params.config.privateKeyPath;
      password = params.config.password;
      passphrase = params.config.passphrase;
      jumpHostConnectionId = params.config.jumpHostConnectionId;
      jumpHostConfig = params.config.jumpHostConfig;
    } else if (params.connectionId) {
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(params.connectionId) as
        | ConnectionRow
        | undefined;
      if (!row) return { ok: false, error: 'Connection not found' };
      if (row.provider !== 'sftp') {
        return { ok: false, error: 'Not an SSH connection' };
      }
      if (!row.host || !row.username || !row.auth_type || row.port == null) {
        return { ok: false, error: 'SSH connection is missing required fields' };
      }

      host = row.host;
      port = row.port;
      username = row.username;
      authType = row.auth_type;
      privateKeyPath = row.private_key_path || undefined;
      jumpHostConnectionId = row.jump_host_connection_id || undefined;
      if (
        row.jump_host_host &&
        row.jump_host_username &&
        row.jump_host_auth_type &&
        row.jump_host_port
      ) {
        jumpHostConfig = {
          host: row.jump_host_host,
          port: row.jump_host_port,
          username: row.jump_host_username,
          authType: row.jump_host_auth_type as import('@shared/types/connection').AuthType,
          privateKeyPath: row.jump_host_private_key_path || undefined,
        };
        await this.resolveJumpHostCredentials(params.connectionId, jumpHostConfig);
      }
    } else {
      return { ok: false, error: 'Invalid test parameters' };
    }

    // Open the bastion channel up-front so a bastion failure surfaces a
    // clear, prefixed error instead of getting buried in target-side
    // socket errors.
    let jumpDispose: (() => void) | undefined;
    let jumpSock: import('stream').Duplex | undefined;
    if (jumpHostConnectionId || jumpHostConfig) {
      try {
        const channel = await openJumpChannel({
          jumpConnectionId: jumpHostConnectionId,
          jumpHostConfig,
          targetHost: host,
          targetPort: port,
          pendingHostKeys: this.pendingHostKeys,
        });
        jumpSock = channel.sock;
        jumpDispose = channel.dispose;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const { config, error: configError } = await buildConnectConfig(
      { host, port, username, authType, privateKeyPath, password, passphrase },
      {
        pendingHostKeys: this.pendingHostKeys,
        connectionId: params.connectionId,
        sock: jumpSock,
      },
    );
    if (configError) {
      jumpDispose?.();
      return { ok: false, error: configError };
    }

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
        jumpDispose?.();
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
      client.once('ready', () => {
        clearTimeout(timer);
        finish({ ok: true });
      });
      client.once('error', (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: describeSshError(err) });
      });
      // A socket closing without 'ready' or 'error' (e.g. server drops the
      // connection mid-handshake) would otherwise leave the promise pending
      // until the 'connection test timed out' timer fires.
      client.once('close', () => {
        clearTimeout(timer);
        finish({ ok: false, error: 'Connection closed before handshake completed' });
      });
      try {
        client.connect(config);
      } catch (err: unknown) {
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  listSessions(): { id: string; connectionId: string; status: SessionStatus }[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      connectionId: s.connectionId,
      status: s.status,
    }));
  }

  getSession(sessionId: string): SshSession | undefined {
    return this.sessions.get(sessionId);
  }

  disconnectAll(): void {
    // Snapshot keys before iterating: disconnect() mutates this.sessions
    // (delete on success path), which would otherwise skip entries.
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      this.disconnect(id);
    }
  }

  /**
   * Retrieve and attach credentials (password or key passphrase) to a manual
   * jump-host configuration from the secure store.
   */
  private async resolveJumpHostCredentials(
    connectionId: string,
    config: import('@shared/types/connection').ManualJumpHostConfig,
  ): Promise<void> {
    const { retrieveCredential } = await import('./credential-store');
    const secret = retrieveCredential(`jumphost:${connectionId}`);
    if (secret) {
      if (config.authType === 'password') {
        config.password = secret;
      } else if (config.authType === 'key+passphrase') {
        config.passphrase = secret;
      }
    }
  }
}

export const sshManager = new SshManager();
