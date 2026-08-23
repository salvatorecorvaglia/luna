import { IPC, LIMITS } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import type {
  ActivePortForwardInfo,
  AuthType,
  PortForwardingConfig,
} from '@shared/types/connection';
import type { SessionStatus } from '@shared/types/terminal';
import { Client, type ClientChannel } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { getRuntimeNumber } from '../config/runtime';
import { describeSshError } from '../lib/error-map';
import log from '../lib/logger';
import { TimeoutError, withTimeout } from '../lib/with-timeout';
import { type ConnectionRow, getDatabase, getSetting } from './database';
import { emitToRenderer } from './emit';
import { PendingHostKeyRegistry } from './ssh/host-key-flow';
import { type PortForwardHandle, startPortForward } from './ssh/port-forward';
import { parseStoredPortForwards, validatePortForwardConfig } from './ssh/port-forward-config';
import { buildConnectConfig, type ConnectParams } from './ssh/ssh-config';
import { sshStreamBuffer } from './ssh/ssh-stream-buffer';

/**
 * Columns needed to build an SSH `ConnectConfig` from the connections table —
 * shared by connect() and testConnection(). Excludes S3-only fields and
 * UI-only metadata.
 */
const SSH_CONNECT_COLUMNS = `
  provider, host, port, username, auth_type, private_key_path,
  keepalive_interval, keepalive_count_max, port_forwards
`;
type SshConnectRow = Pick<
  ConnectionRow,
  | 'provider'
  | 'host'
  | 'port'
  | 'username'
  | 'auth_type'
  | 'private_key_path'
  | 'keepalive_interval'
  | 'keepalive_count_max'
  | 'port_forwards'
>;

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
  portForwards?: PortForwardHandle[];
}

/** Maximum delay between reconnect attempts (ms). The backoff doubles up to this cap. */
const MAX_RECONNECT_DELAY_MS = getRuntimeNumber('SSH_RECONNECT_MAX_DELAY_MS');
/** Base delay for the first reconnect attempt (ms). */
const RECONNECT_BASE_DELAY_MS = getRuntimeNumber('SSH_RECONNECT_BASE_DELAY_MS');

/**
 * How often to prune `connection_history`. The prune used to run on every
 * successful connect, executing a correlated `NOT IN (SELECT … ORDER BY …
 * LIMIT 1000)` subquery each time — a full scan + sort on the hot connect
 * path for a table that only needs trimming occasionally.
 */
const HISTORY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** Retained `connection_history` rows. */
const HISTORY_RETENTION_ROWS = 1000;

class SshManager {
  private sessions = new Map<string, SshSession>();
  private onDisconnectCallbacks: ((sessionId: string) => void)[] = [];
  private onConnectCallbacks: ((sessionId: string) => void)[] = [];
  /** Candidate host keys captured during a rejected verification, awaiting user trust. */
  private pendingHostKeys = new PendingHostKeyRegistry();
  /** Timestamp of the last `connection_history` prune — see pruneHistoryIfDue. */
  private lastHistoryPruneAt = 0;

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

  /**
   * Close out the history row opened at connect time. Shared by the manual
   * `disconnect()` path and `retireSession()`; previously only the former
   * wrote it, so a session that exhausted its reconnect attempts left a row
   * with a null `disconnected_at` forever.
   */
  private recordDisconnectHistory(session: SshSession): void {
    if (!session.historyId) return;
    try {
      const db = getDatabase();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(
        'UPDATE connection_history SET disconnected_at = ?, duration_secs = (? - connected_at) WHERE id = ?',
      ).run(now, now, session.historyId);
    } catch (err) {
      log.warn(`[SSH] Failed to record disconnect history for ${session.historyId}:`, err);
    }
    session.historyId = undefined;
  }

  /**
   * Trim `connection_history` at most once an hour rather than on every
   * connect. The delete is a full scan + sort of the table; running it inline
   * with each handshake put that cost on the interactive connect path for no
   * benefit — a few hundred extra rows between prunes are harmless.
   */
  private pruneHistoryIfDue(db: ReturnType<typeof getDatabase>): void {
    const now = Date.now();
    if (now - this.lastHistoryPruneAt < HISTORY_PRUNE_INTERVAL_MS) return;
    this.lastHistoryPruneAt = now;
    db.prepare(
      `DELETE FROM connection_history
       WHERE id NOT IN (
         SELECT id FROM connection_history ORDER BY connected_at DESC LIMIT ?
       )`,
    ).run(HISTORY_RETENTION_ROWS);
  }

  async connect(
    sessionId: string,
    connectionId: string,
    cols = 80,
    rows = 24,
  ): Promise<{ success: boolean; error?: string }> {
    const db = getDatabase();
    const row = db
      .prepare(`SELECT ${SSH_CONNECT_COLUMNS} FROM connections WHERE id = ?`)
      .get(connectionId) as SshConnectRow | undefined;
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
      this.cleanupPortForwards(existing);
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

    const { config: connectConfig, error: configError } = await buildConnectConfig(
      {
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        privateKeyPath: row.private_key_path,
        keepaliveInterval: row.keepalive_interval ?? undefined,
        keepaliveCountMax: row.keepalive_count_max ?? undefined,
      },
      { pendingHostKeys: this.pendingHostKeys, connectionId, sessionId },
    );
    if (this.sessions.get(sessionId) !== session) {
      return { success: false, error: 'Connection aborted' };
    }
    if (configError) {
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
          this.pruneHistoryIfDue(db);
        } catch (err) {
          log.warn(`[SSH] Failed to record connection info for ${connectionId}:`, err);
        }

        // Fire-and-forget: a forward that fails to bind must not block the
        // shell from opening. Each failure is reported individually so the
        // user learns *which* tunnel died rather than losing the session.
        void this.startConfiguredPortForwards(session, row.port_forwards);

        client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
          if (err) {
            // Clean up session on shell creation failure. Destroy the client
            // too — without it the TCP socket and keepalive timer stay alive
            // on a Client nothing references any more.
            this.cleanupPortForwards(session);
            try {
              client.removeAllListeners();
              client.destroy();
            } catch {
              // already torn down
            }
            this.sessions.delete(sessionId);
            settle({ success: false, error: err.message });
            return;
          }

          session.shell = stream;

          const queueSshData = (chunk: Buffer): void => {
            sshStreamBuffer.queueData(sessionId, chunk, (data) => {
              emitToRenderer(IPC.SSH_ON_DATA, { sessionId, data });
            });
          };

          const onData = (data: Buffer): void => {
            queueSshData(data);
          };

          const onShellClose = (): void => {
            this.handleDisconnect(sessionId);
          };

          const onStderrData = (data: Buffer): void => {
            queueSshData(data);
          };

          stream.on('data', onData);
          stream.on('close', onShellClose);
          stream.stderr.on('data', onStderrData);

          // Store listener refs for cleanup
          session._streamListeners = { onData, onClose: onShellClose, onStderrData };

          // Identity guard: if the sessions map has moved on (e.g. manual disconnect
          // during shell connection), do not trigger connect callbacks or resolve.
          if (this.sessions.get(sessionId) !== session) return;

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

          // Identity guard: if the sessions map has moved on (manual disconnect
          // → reconnect, or a rapid double-connect with the same sessionId),
          // these long-lived listeners must not corrupt the new session entry.
          // removeAllListeners() during the cleanup path drops these handlers,
          // but a callback already queued by a prior emit could still fire —
          // bail when the captured session reference is no longer current.
          client.on('error', (err) => {
            if (this.sessions.get(sessionId) !== session) return;
            const friendly = describeSshError(err);
            emitToRenderer(IPC.SSH_ON_ERROR, { sessionId, error: friendly });
            this.handleDisconnect(sessionId);
          });
          client.on('close', () => {
            if (this.sessions.get(sessionId) !== session) return;
            if (session.status === 'connected') this.handleDisconnect(sessionId);
          });
        });
      };

      onError = (err: Error): void => {
        const friendly = describeSshError(err);
        emitToRenderer(IPC.SSH_ON_ERROR, { sessionId, error: friendly });
        this.sessions.delete(sessionId);
        settle({ success: false, error: friendly });
      };

      onClose = (): void => {
        // Handshake aborted or socket closed before ready
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
    sshStreamBuffer.disposeSession(session.id);
  }

  private cleanupPortForwards(session: SshSession): void {
    if (session.portForwards) {
      for (const pf of session.portForwards) {
        pf.status = 'stopped';
        pf.close().catch((err) => {
          log.warn(`[SSH] Failed to close port forward:`, err);
        });
      }
      delete session.portForwards;
    }
  }

  /** Project a live handle into the renderer-facing shape. */
  private toActiveInfo(session: SshSession, pf: PortForwardHandle): ActivePortForwardInfo {
    return {
      id: pf.id,
      connectionId: session.connectionId,
      sessionId: session.id,
      type: pf.config.type,
      bindAddress: pf.config.bindAddress,
      localPort: pf.config.localPort,
      remoteHost: pf.config.remoteHost,
      remotePort: pf.config.remotePort,
      status: pf.status,
      error: pf.error,
      bytesRead: pf.bytesRead,
      bytesWritten: pf.bytesWritten,
      activeConnections: pf.activeConnections,
    };
  }

  listActivePortForwards(sessionId?: string): ActivePortForwardInfo[] {
    const results: ActivePortForwardInfo[] = [];
    const sessions = sessionId
      ? [this.sessions.get(sessionId)].filter((s): s is SshSession => Boolean(s))
      : Array.from(this.sessions.values());

    for (const session of sessions) {
      if (!session.portForwards) continue;
      for (const pf of session.portForwards) {
        results.push(this.toActiveInfo(session, pf));
      }
    }
    return results;
  }

  /**
   * Whether the user has opted into binding local/dynamic forwards to a
   * non-loopback address. Defaults to false — see port-forward-config.ts.
   */
  private allowPublicBind(): boolean {
    return getSetting<boolean>('ssh.allowPublicPortForwardBind', false) === true;
  }

  /**
   * Start a forward requested interactively from the Tunnel Manager.
   * Async so a bind failure (EADDRINUSE, EACCES, remote refusal) reaches the
   * renderer as a real error instead of a handle that claims to be active.
   */
  async startSinglePortForward(
    sessionId: string,
    rawConfig: unknown,
  ): Promise<ActivePortForwardInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new LunaError(`Session ${sessionId} not found`, ErrorCode.NOT_FOUND);
    }
    const config = validatePortForwardConfig(rawConfig, {
      allowPublicBind: this.allowPublicBind(),
    });
    if (!config.id) config.id = uuidv4();

    // Reject a duplicate local bind up front with a clear message rather than
    // letting the OS return an opaque EADDRINUSE.
    if (config.type !== 'remote') {
      const clash = this.findLocalBindClash(config);
      if (clash) {
        throw new LunaError(
          `Port ${config.localPort} is already forwarded by "${clash.config.name ?? clash.id}"`,
          ErrorCode.VALIDATION_ERROR,
          { reason: 'port-in-use', localPort: config.localPort },
        );
      }
    }

    const handle = await startPortForward(session.client, config);
    // The session could have been torn down while we awaited the bind.
    if (this.sessions.get(sessionId) !== session) {
      await handle.close().catch(() => {});
      throw new LunaError(
        `Session ${sessionId} closed while starting forward`,
        ErrorCode.NOT_FOUND,
      );
    }
    session.portForwards ??= [];
    session.portForwards.push(handle);
    return this.toActiveInfo(session, handle);
  }

  /** Find an active local/dynamic forward already bound to the same host:port. */
  private findLocalBindClash(config: PortForwardingConfig): PortForwardHandle | undefined {
    for (const session of this.sessions.values()) {
      for (const pf of session.portForwards ?? []) {
        if (pf.status !== 'active' || pf.config.type === 'remote') continue;
        if (
          pf.config.localPort === config.localPort &&
          pf.config.bindAddress === config.bindAddress
        ) {
          return pf;
        }
      }
    }
    return undefined;
  }

  async stopSinglePortForward(sessionId: string, forwardId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.portForwards) return;
    const index = session.portForwards.findIndex((pf) => pf.id === forwardId);
    if (index !== -1) {
      // Non-null: a valid index guarantees splice(index, 1) removes one element.
      const pf = session.portForwards.splice(index, 1)[0]!;
      pf.status = 'stopped';
      await pf.close().catch((err) => {
        log.warn(`[SSH] Failed to close port forward ${forwardId}:`, err);
      });
    }
  }

  /**
   * Start the forwards saved on the connection row. Invalid entries are
   * dropped during parsing; entries that fail to bind are reported to the
   * renderer individually so one busy port doesn't silently disable the rest.
   */
  private async startConfiguredPortForwards(
    session: SshSession,
    portForwardsJson: string | null,
  ): Promise<void> {
    const configs = parseStoredPortForwards(portForwardsJson, {
      allowPublicBind: this.allowPublicBind(),
    });
    if (configs.length === 0) return;

    // Started in parallel: forwards are independent, and binding is the slow
    // part. Serialising them meant one forward waiting on a slow remote
    // `forwardIn` delayed every later tunnel on the same session.
    await Promise.all(
      configs.map(async (config) => {
        try {
          const handle = await startPortForward(session.client, config);
          // The session may have been torn down while we were binding.
          if (this.sessions.get(session.id) !== session) {
            await handle.close().catch(() => {});
            return;
          }
          session.portForwards ??= [];
          session.portForwards.push(handle);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error(`[SSH] Port forward on ${config.localPort} failed to start: ${message}`);
          emitToRenderer(IPC.SSH_ON_ERROR, {
            sessionId: session.id,
            error: `Port forward ${config.name ?? config.localPort} could not start: ${message}`,
          });
        }
      }),
    );
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.status === 'disconnected') return;

    this.cleanupPortForwards(session);
    this.cleanupStreamListeners(session);
    this.setStatus(session, 'disconnected');
    emitToRenderer(IPC.SSH_ON_CLOSE, { sessionId });

    // Notify listeners (e.g. SFTP cache cleanup)
    for (const cb of this.onDisconnectCallbacks) {
      try {
        cb(sessionId);
      } catch (cbErr) {
        log.warn(`[SSH] onDisconnect callback threw for ${sessionId}:`, cbErr);
      }
    }

    // Auto-reconnect, if the user hasn't turned it off. The `ssh.autoReconnect`
    // setting has always been surfaced in the Settings panel and persisted,
    // but nothing read it — a user who deliberately disabled reconnection
    // still got reconnected. Honour it here, at the single entry point.
    if (getSetting<boolean>('ssh.autoReconnect', true) === false) {
      this.retireSession(session, 'disconnected');
      return;
    }
    this.attemptReconnect(sessionId);
  }

  /**
   * Drop a session that will not be reconnected. Without this the entry stayed
   * in `this.sessions` forever holding a dead Client, so `listSessions()` (and
   * therefore renderer session recovery) kept reporting a session that could
   * never carry traffic again.
   */
  private retireSession(session: SshSession, status: SessionStatus): void {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    session.reconnecting = false;
    session.reconnectGen++;
    this.setStatus(session, status);
    this.cleanupPortForwards(session);
    this.cleanupStreamListeners(session);
    try {
      session.client.removeAllListeners();
      session.client.destroy();
    } catch {
      // already torn down
    }
    this.recordDisconnectHistory(session);
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
    }
  }

  private attemptReconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // A pending timer means a reconnect is already scheduled — don't stack them.
    if (session.reconnectTimer) return;

    const maxAttempts = getSetting('ssh.maxReconnectAttempts', 5);
    if (session.reconnectAttempts >= maxAttempts) {
      log.warn(`[SSH] Giving up on ${sessionId} after ${maxAttempts} reconnect attempts`);
      emitToRenderer(IPC.SSH_ON_ERROR, {
        sessionId,
        error: `Reconnection failed after ${maxAttempts} attempts. Reconnect manually to try again.`,
      });
      this.retireSession(session, 'error');
      return;
    }

    session.reconnecting = true;
    session.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (session.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS,
    );

    this.setStatus(session, 'reconnecting');

    // Capture the generation so the timer body can detect "I'm stale".
    const gen = session.reconnectGen;
    // Wrap the entire async body in a terminal try/catch. setTimeout's
    // callback returns a Promise (the timer doesn't await it), so any
    // rejection escaping this scope lands as an unhandled rejection and
    // hits the process's uncaughtException handler — kills observability
    // of the actual SSH lifecycle failure that caused it.
    session.reconnectTimer = setTimeout(() => {
      void (async () => {
        try {
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

          const connectionId = sess.connectionId;
          const reconnectAttempts = sess.reconnectAttempts;
          const cols = sess.cols;
          const rows = sess.rows;

          // connect() should always resolve with {success}, but treat a thrown
          // error the same as a failed reconnect.
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
        } catch (err) {
          // Last-resort: route any leak to the logger rather than letting it
          // escape as an unhandled rejection from inside a setTimeout.
          log.error(`[SSH] Reconnect timer body threw for ${sessionId}:`, err);
          const sess = this.sessions.get(sessionId);
          if (sess && sess.reconnectGen === gen) {
            sess.reconnecting = false;
          }
        }
      })();
    }, delay);
  }

  /**
   * Write keystrokes to the session's shell.
   *
   * Returns false when the write could not be delivered. Silently dropping
   * input made a half-dead session indistinguishable from a working one: the
   * user typed, nothing echoed, and no error appeared anywhere. The IPC layer
   * turns a false return into a structured error the terminal can surface.
   */
  sendData(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (!session.shell?.writable) return false;
    session.shell.write(data);
    return true;
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

    this.cleanupPortForwards(session);
    this.cleanupStreamListeners(session);

    try {
      session.shell?.close();
      session.client.end();
    } catch (err) {
      log.error(`[SSH] Error closing session ${sessionId}:`, err);
    }

    this.recordDisconnectHistory(session);

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
   * Resolve test-connection parameters from either a saved connection row or
   * a raw config supplied by the form.
   *
   * Both branches produce the same `ConnectParams`, so they are built directly
   * rather than laundered through eight mutable locals — the previous shape
   * made it impossible to see at a glance which fields the saved-connection
   * branch deliberately leaves unset (password/passphrase, which come from the
   * credential store inside buildConnectConfig, never from the row).
   */
  private resolveTestParams(params: {
    connectionId?: string;
    config?: {
      host: string;
      port: number;
      username: string;
      authType: AuthType;
      privateKeyPath?: string;
      password?: string;
      passphrase?: string;
      keepaliveInterval?: number;
      keepaliveCountMax?: number;
    };
  }): { params: ConnectParams } | { error: string } {
    if (params.config) {
      const c = params.config;
      return {
        params: {
          host: c.host,
          port: c.port,
          username: c.username,
          authType: c.authType,
          privateKeyPath: c.privateKeyPath,
          password: c.password,
          passphrase: c.passphrase,
          keepaliveInterval: c.keepaliveInterval,
          keepaliveCountMax: c.keepaliveCountMax,
        },
      };
    }

    if (!params.connectionId) {
      return { error: 'Invalid test parameters' };
    }

    const row = getDatabase()
      .prepare(`SELECT ${SSH_CONNECT_COLUMNS} FROM connections WHERE id = ?`)
      .get(params.connectionId) as SshConnectRow | undefined;
    if (!row) return { error: 'Connection not found' };
    if (row.provider !== 'sftp') return { error: 'Not an SSH connection' };
    if (!row.host || !row.username || !row.auth_type || row.port == null) {
      return { error: 'SSH connection is missing required fields' };
    }

    return {
      params: {
        host: row.host,
        port: row.port,
        username: row.username,
        authType: row.auth_type,
        privateKeyPath: row.private_key_path || undefined,
        keepaliveInterval: row.keepalive_interval || undefined,
        keepaliveCountMax: row.keepalive_count_max || undefined,
      },
    };
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
      keepaliveInterval?: number;
      keepaliveCountMax?: number;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    const resolved = this.resolveTestParams(params);
    if ('error' in resolved) return { ok: false, error: resolved.error };

    const { config, error: configError } = await buildConnectConfig(resolved.params, {
      pendingHostKeys: this.pendingHostKeys,
      connectionId: params.connectionId,
    });
    if (configError) {
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
        resolve(result);
      };
      const timeoutMs = getSetting('ssh.connectTimeoutMs', LIMITS.SSH_CONNECT_TIMEOUT_MS);
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: `Connection test timed out after ${timeoutMs}ms`,
          }),
        timeoutMs,
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

  /** Number of tracked sessions (any status) — used to cap concurrent connects. */
  sessionCount(): number {
    return this.sessions.size;
  }

  disconnectAll(): void {
    // Snapshot keys before iterating: disconnect() mutates this.sessions
    // (delete on success path), which would otherwise skip entries.
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      this.disconnect(id);
    }
    sshStreamBuffer.disposeAll();
  }
}

export const sshManager = new SshManager();
