import { createServer, connect as netConnect } from 'node:net';
import { IPC, LIMITS } from '@shared/constants';
import type { AuthType, PortForwardingConfig } from '@shared/types/connection';
import type { SessionStatus } from '@shared/types/terminal';
import { Client, type ClientChannel } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { getRuntimeNumber } from '../config/runtime';
import { describeSshError } from '../lib/error-map';
import log from '../lib/logger';
import { TimeoutError, withTimeout } from '../lib/with-timeout';
import { type ConnectionRow, getDatabase, getSetting } from './database';
import { emitToRenderer } from './emit';
import { bastionService } from './ssh/bastion-service';
import { PendingHostKeyRegistry } from './ssh/host-key-flow';
import { extractManualJumpHostConfig } from './ssh/jump-host-helper';
import { buildConnectConfig } from './ssh/ssh-config';
import { sshStreamBuffer } from './ssh/ssh-stream-buffer';

/**
 * Columns needed to build an SSH `ConnectConfig` from the connections table —
 * shared by connect() and testConnection(). Excludes S3-only fields and
 * UI-only metadata.
 */
const SSH_CONNECT_COLUMNS = `
  provider, host, port, username, auth_type, private_key_path,
  jump_host_connection_id, jump_host_host, jump_host_port,
  jump_host_username, jump_host_auth_type, jump_host_private_key_path,
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
  | 'jump_host_connection_id'
  | 'jump_host_host'
  | 'jump_host_port'
  | 'jump_host_username'
  | 'jump_host_auth_type'
  | 'jump_host_private_key_path'
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
  /**
   * Tear-down hook for an associated jump-host (bastion) client. When the
   * target session connects via ProxyJump, the underlying bastion `Client`
   * lives alongside this session and must be ended when the session ends.
   * Idempotent — safe to call from both error paths and `disconnect()`.
   */
  jumpDispose?: () => void;
  portForwards?: Array<{
    config: PortForwardingConfig;
    close: () => Promise<void>;
  }>;
}

/** Maximum delay between reconnect attempts (ms). The backoff doubles up to this cap. */
const MAX_RECONNECT_DELAY_MS = getRuntimeNumber('SSH_RECONNECT_MAX_DELAY_MS');
/** Base delay for the first reconnect attempt (ms). */
const RECONNECT_BASE_DELAY_MS = getRuntimeNumber('SSH_RECONNECT_BASE_DELAY_MS');

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

    // Open the jump-host channel *before* building the target config so a
    // bastion failure short-circuits without spinning up a target Client.
    // The resulting Duplex becomes the target's `sock`.
    let jumpSock: import('node:stream').Duplex | undefined;
    if (row.jump_host_connection_id || row.jump_host_host) {
      try {
        const manualConfig = extractManualJumpHostConfig(row);

        const channel = await bastionService.openChannel({
          connectionId,
          jumpConnectionId: row.jump_host_connection_id || undefined,
          jumpHostConfig: manualConfig,
          targetHost: row.host,
          targetPort: row.port,
          pendingHostKeys: this.pendingHostKeys,
          sessionId,
        });
        if (this.sessions.get(sessionId) !== session) {
          channel.dispose();
          return { success: false, error: 'Connection aborted' };
        }
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
        keepaliveInterval: row.keepalive_interval ?? undefined,
        keepaliveCountMax: row.keepalive_count_max ?? undefined,
      },
      { pendingHostKeys: this.pendingHostKeys, connectionId, sessionId, sock: jumpSock },
    );
    if (this.sessions.get(sessionId) !== session) {
      session.jumpDispose?.();
      return { success: false, error: 'Connection aborted' };
    }
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
          // Prune history: retain the most recent 1,000 entries
          db.prepare(
            'DELETE FROM connection_history WHERE id NOT IN (SELECT id FROM connection_history ORDER BY connected_at DESC LIMIT 1000)',
          ).run();
        } catch (err) {
          log.warn(`[SSH] Failed to record connection info for ${connectionId}:`, err);
        }

        try {
          this.startPortForwards(session, row.port_forwards);
        } catch (err) {
          log.error(`[SSH] Failed to start port forwards for session ${sessionId}:`, err);
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
    sshStreamBuffer.disposeSession(session.id);
  }

  private cleanupPortForwards(session: SshSession): void {
    if (session.portForwards) {
      for (const pf of session.portForwards) {
        pf.close().catch((err) => {
          log.warn(`[SSH] Failed to close port forward:`, err);
        });
      }
      delete session.portForwards;
    }
  }

  private startPortForwards(session: SshSession, portForwardsJson: string | null): void {
    if (!portForwardsJson) return;
    let configs: PortForwardingConfig[];
    try {
      configs = JSON.parse(portForwardsJson);
    } catch (err) {
      log.error('[SSH] Failed to parse port forwards JSON:', err);
      return;
    }
    if (!Array.isArray(configs) || configs.length === 0) return;

    session.portForwards = [];

    for (const config of configs) {
      if (config.type === 'local') {
        const server = createServer((socket) => {
          const client = session.client;
          client.forwardOut(
            config.bindAddress || '127.0.0.1',
            config.localPort,
            config.remoteHost || '127.0.0.1',
            config.remotePort || 80,
            (err, stream) => {
              if (err) {
                log.error(
                  `[SSH] Local port forward forwardOut failed for port ${config.localPort}:`,
                  err,
                );
                socket.destroy();
                return;
              }
              socket.pipe(stream).pipe(socket);
              socket.on('error', () => stream.end());
              stream.on('error', () => socket.destroy());
            },
          );
        });

        server.on('error', (err) => {
          log.error(`[SSH] Local port forward server error on port ${config.localPort}:`, err);
        });

        server.listen(config.localPort, config.bindAddress || '127.0.0.1', () => {
          log.info(
            `[SSH] Local port forward listening on ${config.bindAddress || '127.0.0.1'}:${config.localPort}`,
          );
        });

        session.portForwards.push({
          config,
          close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
        });
      } else if (config.type === 'remote') {
        const client = session.client;
        const remoteBind = config.bindAddress || '127.0.0.1';
        const remotePort = config.localPort;
        const localDestHost = config.remoteHost || '127.0.0.1';
        const localDestPort = config.remotePort || 80;

        client.forwardIn(remoteBind, remotePort, (err) => {
          if (err) {
            log.error(
              `[SSH] Remote port forward forwardIn failed for remote port ${remotePort}:`,
              err,
            );
          } else {
            log.info(`[SSH] Remote port forward requested on remote ${remoteBind}:${remotePort}`);
          }
        });

        // biome-ignore lint/suspicious/noExplicitAny: ssh2 callback arguments
        const tcpListener = (info: any, accept: () => any, reject: () => void) => {
          if (info.destPort === remotePort) {
            const localSocket = netConnect(localDestPort, localDestHost, () => {
              const stream = accept();
              localSocket.pipe(stream).pipe(localSocket);
              localSocket.on('error', () => stream.end());
              stream.on('error', () => localSocket.destroy());
            });
            localSocket.on('error', (err) => {
              log.error(
                `[SSH] Remote port forward local connect failed to ${localDestHost}:${localDestPort}:`,
                err,
              );
              reject();
            });
          }
        };

        client.on('tcp connection', tcpListener);

        session.portForwards.push({
          config,
          close: () =>
            new Promise<void>((resolveClose) => {
              client.off('tcp connection', tcpListener);
              client.unforwardIn(remoteBind, remotePort, () => resolveClose());
            }),
        });
      } else if (config.type === 'dynamic') {
        const server = createServer((socket) => {
          let stage = 0;
          socket.on('data', (chunk) => {
            const client = session.client;
            if (stage === 0) {
              if (chunk[0] !== 0x05) {
                socket.destroy();
                return;
              }
              const response = Buffer.from([0x05, 0x00]);
              socket.write(response);
              stage = 1;
            } else if (stage === 1) {
              if (chunk[0] !== 0x05 || chunk[1] !== 0x01) {
                socket.write(
                  Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
                );
                socket.destroy();
                return;
              }
              let offset = 4;
              const atyp = chunk[3];
              let host = '';
              if (atyp === 0x01) {
                host = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`;
                offset = 8;
              } else if (atyp === 0x03) {
                const len = chunk[4];
                host = chunk.toString('utf8', 5, 5 + len);
                offset = 5 + len;
              } else if (atyp === 0x04) {
                const groups: string[] = [];
                for (let i = 0; i < 16; i += 2) {
                  groups.push(chunk.readUInt16BE(4 + i).toString(16));
                }
                host = groups.join(':');
                offset = 20;
              } else {
                socket.destroy();
                return;
              }
              const port = chunk.readUInt16BE(offset);

              client.forwardOut('127.0.0.1', config.localPort, host, port, (err, stream) => {
                if (err) {
                  log.error(`[SSH] Dynamic SOCKS5 forwardOut failed to ${host}:${port}:`, err);
                  socket.write(
                    Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
                  );
                  socket.destroy();
                  return;
                }
                socket.write(
                  Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
                );
                socket.pipe(stream).pipe(socket);
                socket.on('error', () => stream.end());
                stream.on('error', () => socket.destroy());
              });
              stage = 2;
            }
          });
        });

        server.on('error', (err) => {
          log.error(`[SSH] Dynamic SOCKS5 proxy server error on port ${config.localPort}:`, err);
        });

        server.listen(config.localPort, config.bindAddress || '127.0.0.1', () => {
          log.info(
            `[SSH] Dynamic SOCKS5 proxy server listening on ${config.bindAddress || '127.0.0.1'}:${config.localPort}`,
          );
        });

        session.portForwards.push({
          config,
          close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
        });
      }
    }
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.status === 'disconnected') return;

    this.cleanupPortForwards(session);
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

    this.cleanupPortForwards(session);
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
      keepaliveInterval?: number;
      keepaliveCountMax?: number;
    };
  }): Promise<{ ok: boolean; error?: string }> {
    let host: string, port: number, username: string, authType: AuthType;
    let privateKeyPath: string | undefined;
    let password: string | undefined;
    let passphrase: string | undefined;
    let jumpHostConnectionId: string | undefined;
    let jumpHostConfig: import('@shared/types/connection').ManualJumpHostConfig | undefined;
    let keepaliveInterval: number | undefined;
    let keepaliveCountMax: number | undefined;

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
      keepaliveInterval = params.config.keepaliveInterval;
      keepaliveCountMax = params.config.keepaliveCountMax;
    } else if (params.connectionId) {
      const db = getDatabase();
      const row = db
        .prepare(`SELECT ${SSH_CONNECT_COLUMNS} FROM connections WHERE id = ?`)
        .get(params.connectionId) as SshConnectRow | undefined;
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
      keepaliveInterval = row.keepalive_interval || undefined;
      keepaliveCountMax = row.keepalive_count_max || undefined;
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
      }
    } else {
      return { ok: false, error: 'Invalid test parameters' };
    }

    // Open the bastion channel up-front so a bastion failure surfaces a
    // clear, prefixed error instead of getting buried in target-side
    // socket errors.
    let jumpDispose: (() => void) | undefined;
    let jumpSock: import('node:stream').Duplex | undefined;
    if (jumpHostConnectionId || jumpHostConfig) {
      try {
        const channel = await bastionService.openChannel({
          connectionId: params.connectionId,
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
      {
        host,
        port,
        username,
        authType,
        privateKeyPath,
        password,
        passphrase,
        keepaliveInterval,
        keepaliveCountMax,
      },
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
