import { createServer, connect as netConnect, type Server, type Socket } from 'node:net';
import { ErrorCode, LunaError } from '@shared/errors';
import type { PortForwardingConfig } from '@shared/types/connection';
import type { Client, ClientChannel } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import log from '../../lib/logger';

/**
 * How long to wait for the server to acknowledge `unforwardIn` before giving
 * up and treating the remote forward as closed. Generous, because a healthy
 * server answers in milliseconds — this only fires on a dead transport.
 */
const UNFORWARD_TIMEOUT_MS = 5_000;

import {
  buildGreetingResponse,
  buildReply,
  MAX_HANDSHAKE_BYTES,
  parseGreeting,
  parseRequest,
  SOCKS_REPLY,
} from './socks5';

/**
 * SSH port forwarding (local / remote / dynamic-SOCKS5).
 *
 * Extracted from `SshManager`, which had grown to ~1,000 lines across four
 * unrelated responsibilities. Beyond the move, three behavioural fixes:
 *
 *  1. The SOCKS5 handler no longer indexes into a raw `'data'` chunk. See
 *     `./socks5.ts` — the old code could crash the entire main process on a
 *     fragmented or malformed request.
 *  2. `close()` now tears down in-flight connections. Previously it only
 *     closed the listening socket, so `server.close()` waited on live
 *     connections that nothing would ever end, and the quit watchdog had to
 *     force-kill the process.
 *  3. `start()` is async and resolves only once the socket is actually
 *     listening (or the remote `forwardIn` is accepted), so `EADDRINUSE`
 *     surfaces as a real error instead of a handle that reports
 *     `status: 'active'` while silently doing nothing.
 */

export interface PortForwardHandle {
  readonly id: string;
  readonly config: PortForwardingConfig;
  status: 'active' | 'error' | 'stopped';
  error?: string;
  bytesRead: number;
  bytesWritten: number;
  activeConnections: number;
  close(): Promise<void>;
}

interface Counters {
  bytesRead: number;
  bytesWritten: number;
  activeConnections: number;
}

/**
 * Wire a duplex local socket to an SSH channel, keeping byte counters in
 * sync and making sure either side's failure tears the other down. Shared by
 * all three forward types, which previously each hand-rolled a slightly
 * different variant of this (the `remote` one leaked the SSH stream when the
 * local socket errored before the pipe was established).
 */
function bridge(socket: Socket, stream: ClientChannel, counters: Counters): void {
  stream.on('data', (d: Buffer) => {
    counters.bytesWritten += d.length;
  });
  socket.pipe(stream);
  stream.pipe(socket);
  socket.on('error', () => stream.end());
  stream.on('error', () => socket.destroy());
  stream.on('close', () => socket.destroy());
}

/** Track every accepted socket so `close()` can actually end them. */
function trackSocket(sockets: Set<Socket>, socket: Socket, counters: Counters): void {
  sockets.add(socket);
  counters.activeConnections++;
  const release = (): void => {
    if (sockets.delete(socket)) {
      counters.activeConnections = Math.max(0, counters.activeConnections - 1);
    }
  };
  socket.on('close', release);
}

/** Resolve once the server is listening; reject if binding fails. */
function listenAsync(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onError = (err: NodeJS.ErrnoException): void => {
      if (settled) return;
      settled = true;
      const hint =
        err.code === 'EADDRINUSE'
          ? ` — port ${port} is already in use`
          : err.code === 'EACCES'
            ? ` — binding port ${port} requires elevated privileges`
            : '';
      reject(
        new LunaError(`Failed to bind ${host}:${port}${hint}`, ErrorCode.NETWORK_ERROR, {
          code: err.code,
        }),
      );
    };
    server.once('error', onError);
    // The listen callback is registered as a one-shot 'listening' listener by
    // Node, so success and failure are both covered without a second
    // subscription to unwind.
    server.listen(port, host, () => {
      if (settled) return;
      settled = true;
      server.off('error', onError);
      resolve();
    });
  });
}

/** Close a server and hard-destroy any sockets it is still holding open. */
function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  return new Promise<void>((resolve) => {
    // Destroy tracked connections first: server.close() only stops accepting
    // new ones and waits for existing ones to end on their own, which for a
    // long-lived tunnel is "never".
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    server.close(() => resolve());
  });
}

function startLocalForward(
  client: Client,
  config: PortForwardingConfig,
): Promise<PortForwardHandle> {
  const counters: Counters = { bytesRead: 0, bytesWritten: 0, activeConnections: 0 };
  const sockets = new Set<Socket>();
  const destHost = config.remoteHost ?? '127.0.0.1';
  const destPort = config.remotePort ?? 80;

  const server = createServer((socket) => {
    trackSocket(sockets, socket, counters);
    socket.on('data', (d) => {
      counters.bytesRead += d.length;
    });
    // Hold the inbound bytes until the SSH channel exists, otherwise anything
    // the client sends before forwardOut's callback fires is consumed by the
    // 'data' listener above and dropped on the floor.
    socket.pause();
    client.forwardOut(config.bindAddress, config.localPort, destHost, destPort, (err, stream) => {
      if (err) {
        log.error(`[SSH] local forward ${config.localPort} → ${destHost}:${destPort} failed:`, err);
        socket.destroy();
        return;
      }
      if (socket.destroyed) {
        stream.end();
        return;
      }
      bridge(socket, stream, counters);
      socket.resume();
    });
  });

  const handle: PortForwardHandle = {
    id: config.id || uuidv4(),
    config,
    status: 'active',
    get bytesRead() {
      return counters.bytesRead;
    },
    get bytesWritten() {
      return counters.bytesWritten;
    },
    get activeConnections() {
      return counters.activeConnections;
    },
    close: () => closeServer(server, sockets),
  };

  // Post-listen failures (rare, but e.g. EMFILE on accept) shouldn't be silent.
  server.on('error', (err) => {
    log.error(`[SSH] local forward server error on ${config.localPort}:`, err);
    handle.status = 'error';
    handle.error = err.message;
  });

  return listenAsync(server, config.localPort, config.bindAddress).then(() => {
    log.info(`[SSH] Local forward listening on ${config.bindAddress}:${config.localPort}`);
    return handle;
  });
}

function startRemoteForward(
  client: Client,
  config: PortForwardingConfig,
): Promise<PortForwardHandle> {
  const counters: Counters = { bytesRead: 0, bytesWritten: 0, activeConnections: 0 };
  const sockets = new Set<Socket>();
  const remoteBind = config.bindAddress;
  const remotePort = config.localPort;
  const localDestHost = config.remoteHost ?? '127.0.0.1';
  const localDestPort = config.remotePort ?? 80;

  // biome-ignore lint/suspicious/noExplicitAny: ssh2 does not type its tcp-connection info payload
  const tcpListener = (info: any, accept: () => ClientChannel, reject: () => void): void => {
    if (info?.destPort !== remotePort) {
      // Decline explicitly. Simply returning left the channel pending on the
      // server side for the rest of the session.
      reject();
      return;
    }
    const localSocket = netConnect(localDestPort, localDestHost, () => {
      const stream = accept();
      trackSocket(sockets, localSocket, counters);
      localSocket.on('data', (d) => {
        counters.bytesRead += d.length;
      });
      bridge(localSocket, stream, counters);
    });
    localSocket.on('error', (err) => {
      log.error(
        `[SSH] remote forward could not reach ${localDestHost}:${localDestPort}:`,
        err.message,
      );
      // Only reject if we never accepted — accept() is what turns the pending
      // channel into a stream, and rejecting after that throws inside ssh2.
      if (!sockets.has(localSocket)) {
        try {
          reject();
        } catch {
          // channel already gone
        }
      }
      localSocket.destroy();
    });
  };

  return new Promise<PortForwardHandle>((resolve, rejectPromise) => {
    client.forwardIn(remoteBind, remotePort, (err) => {
      if (err) {
        rejectPromise(
          new LunaError(
            `Server refused to listen on ${remoteBind}:${remotePort} — ${err.message}`,
            ErrorCode.SSH_ERROR,
          ),
        );
        return;
      }
      client.on('tcp connection', tcpListener);
      log.info(`[SSH] Remote forward established on remote ${remoteBind}:${remotePort}`);
      resolve({
        id: config.id || uuidv4(),
        config,
        status: 'active',
        get bytesRead() {
          return counters.bytesRead;
        },
        get bytesWritten() {
          return counters.bytesWritten;
        },
        get activeConnections() {
          return counters.activeConnections;
        },
        close: () =>
          new Promise<void>((resolveClose) => {
            client.off('tcp connection', tcpListener);
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            // The try/catch only covers a *synchronous* throw. On an already-dead
            // transport ssh2 accepts the callback and never invokes it, so this
            // promise never settled — and `stopSinglePortForward` awaits it, so
            // the ssh:stop-port-forward IPC call hung until the renderer gave up,
            // leaking the pending promise and its closure. Settle either way.
            let settled = false;
            const done = (): void => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolveClose();
            };
            const timer = setTimeout(() => {
              log.warn(
                `[PortForward] unforwardIn(${remoteBind}:${remotePort}) did not acknowledge within ` +
                  `${UNFORWARD_TIMEOUT_MS}ms — treating the forward as closed.`,
              );
              done();
            }, UNFORWARD_TIMEOUT_MS);
            timer.unref();
            try {
              client.unforwardIn(remoteBind, remotePort, done);
            } catch {
              // Transport already dead — nothing to unforward.
              done();
            }
          }),
      });
    });
  });
}

/**
 * Per-connection SOCKS5 state. Bytes are accumulated in `pending` and parsed
 * incrementally, so a handshake split across any number of TCP segments is
 * handled identically to one that arrives whole.
 */
function handleSocksConnection(
  socket: Socket,
  client: Client,
  config: PortForwardingConfig,
  counters: Counters,
): void {
  let pending: Buffer = Buffer.alloc(0);
  let stage: 'greeting' | 'request' | 'connecting' | 'piped' = 'greeting';

  const fail = (reason: string, reply?: number): void => {
    log.warn(`[SSH] SOCKS5 rejected on ${config.localPort}: ${reason}`);
    if (reply !== undefined && socket.writable) socket.write(buildReply(reply));
    socket.destroy();
  };

  const onData = (chunk: Buffer): void => {
    counters.bytesRead += chunk.length;
    if (stage === 'piped') return;

    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    if (pending.length > MAX_HANDSHAKE_BYTES) {
      fail(`handshake exceeded ${MAX_HANDSHAKE_BYTES} bytes`, SOCKS_REPLY.GENERAL_FAILURE);
      return;
    }

    if (stage === 'greeting') {
      const greeting = parseGreeting(pending);
      if (greeting.status === 'need-more') return;
      if (greeting.status === 'error') {
        // A bad version byte means the peer isn't speaking SOCKS at all;
        // there is no meaningful reply frame to send.
        fail(greeting.reason);
        return;
      }
      pending = pending.subarray(greeting.consumed);
      socket.write(buildGreetingResponse());
      stage = 'request';
    }

    if (stage === 'request') {
      const request = parseRequest(pending);
      if (request.status === 'need-more') return;
      if (request.status === 'error') {
        fail(request.reason, request.reply);
        return;
      }

      const { host, port } = request;
      // Anything after the request belongs to the tunnelled stream.
      const leftover = pending.subarray(request.consumed);
      pending = Buffer.alloc(0);
      stage = 'connecting';
      // Stop reading until the channel exists; without this, bytes arriving
      // between here and the forwardOut callback are swallowed by this very
      // handler (stage === 'connecting' falls through every branch).
      socket.pause();

      client.forwardOut('127.0.0.1', config.localPort, host, port, (err, stream) => {
        if (err) {
          log.error(`[SSH] SOCKS5 forwardOut to ${host}:${port} failed:`, err.message);
          if (socket.writable) socket.write(buildReply(SOCKS_REPLY.HOST_UNREACHABLE));
          socket.destroy();
          return;
        }
        if (socket.destroyed) {
          stream.end();
          return;
        }
        socket.write(buildReply(SOCKS_REPLY.SUCCEEDED));
        if (leftover.length > 0) stream.write(leftover);
        stage = 'piped';
        // Hand the socket to pipe(); our listener has done its job and would
        // otherwise double-count every byte from here on.
        socket.off('data', onData);
        bridge(socket, stream, counters);
        socket.resume();
      });
    }
  };

  socket.on('data', onData);
  socket.on('error', () => socket.destroy());
}

function startDynamicForward(
  client: Client,
  config: PortForwardingConfig,
): Promise<PortForwardHandle> {
  const counters: Counters = { bytesRead: 0, bytesWritten: 0, activeConnections: 0 };
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    trackSocket(sockets, socket, counters);
    // Every parse path returns a result rather than throwing, but a SOCKS
    // handler that crashes takes down the whole main process — belt and
    // braces is cheap here.
    try {
      handleSocksConnection(socket, client, config, counters);
    } catch (err) {
      log.error('[SSH] SOCKS5 connection handler threw:', err);
      socket.destroy();
    }
  });

  const handle: PortForwardHandle = {
    id: config.id || uuidv4(),
    config,
    status: 'active',
    get bytesRead() {
      return counters.bytesRead;
    },
    get bytesWritten() {
      return counters.bytesWritten;
    },
    get activeConnections() {
      return counters.activeConnections;
    },
    close: () => closeServer(server, sockets),
  };

  server.on('error', (err) => {
    log.error(`[SSH] SOCKS5 proxy server error on ${config.localPort}:`, err);
    handle.status = 'error';
    handle.error = err.message;
  });

  return listenAsync(server, config.localPort, config.bindAddress).then(() => {
    log.info(`[SSH] SOCKS5 proxy listening on ${config.bindAddress}:${config.localPort}`);
    return handle;
  });
}

/**
 * Start a single port forward. The config must already have passed
 * `validatePortForwardConfig` — this function assumes normalised fields.
 */
export function startPortForward(
  client: Client,
  config: PortForwardingConfig,
): Promise<PortForwardHandle> {
  switch (config.type) {
    case 'local':
      return startLocalForward(client, config);
    case 'remote':
      return startRemoteForward(client, config);
    case 'dynamic':
      return startDynamicForward(client, config);
    default: {
      // Unreachable once validation has run, but an exhaustiveness guard here
      // means a future forward type can't silently produce a dead handle.
      const exhaustive: never = config.type;
      return Promise.reject(
        new LunaError(
          `Unknown port forward type: ${String(exhaustive)}`,
          ErrorCode.VALIDATION_ERROR,
        ),
      );
    }
  }
}
