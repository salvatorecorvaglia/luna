import { EventEmitter } from 'node:events';
import { type AddressInfo, createServer, connect as netConnect, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import type { PortForwardingConfig } from '@shared/types/connection';
import type { Client } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/main/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  type PortForwardHandle,
  startPortForward,
} from '../../../../src/main/services/ssh/port-forward';

/**
 * These tests drive the *runtime* — real listening sockets on ephemeral ports,
 * real client connections — with only the ssh2 `Client` faked. Mocking
 * `node:net` instead would have made the assertions vacuous: the behaviour
 * that matters here (does the bind actually fail on a busy port, does close()
 * really tear down a live connection, does a byte-at-a-time SOCKS handshake
 * still work) only exists at the socket layer.
 */

/** Channels are PassThroughs, so anything written comes straight back — an echo peer. */
class FakeClient extends EventEmitter {
  forwardOutCalls: { destHost: string; destPort: number }[] = [];
  /** Set to fail every forwardOut, simulating a dead SSH transport. */
  forwardOutError: Error | null = null;
  channels: PassThrough[] = [];
  unforwardInCalls: { host: string; port: number }[] = [];
  forwardInError: Error | null = null;

  forwardOut(
    _srcHost: string,
    _srcPort: number,
    destHost: string,
    destPort: number,
    cb: (err: Error | undefined, channel?: PassThrough) => void,
  ): void {
    this.forwardOutCalls.push({ destHost, destPort });
    if (this.forwardOutError) {
      setImmediate(() => cb(this.forwardOutError ?? undefined));
      return;
    }
    const channel = new PassThrough();
    this.channels.push(channel);
    setImmediate(() => cb(undefined, channel));
  }

  forwardIn(_host: string, _port: number, cb: (err?: Error) => void): void {
    setImmediate(() => cb(this.forwardInError ?? undefined));
  }

  unforwardIn(host: string, port: number, cb: () => void): void {
    this.unforwardInCalls.push({ host, port });
    setImmediate(cb);
  }
}

function asClient(fake: FakeClient): Client {
  return fake as unknown as Client;
}

/** Reserve then release a port so the forward can bind it. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}

interface Reader {
  read(n: number): Promise<Buffer>;
}

/**
 * Buffering reader over a socket.
 *
 * A naive "attach a listener, resolve at n bytes, detach" helper silently
 * drops whatever arrived past `n` in the same segment. That made the
 * glued-payload test pass in isolation and fail under load, which is the
 * worst kind of test: the flake looks like a product bug. Keeping one
 * listener and one residual buffer per socket makes reads sequential and
 * framing-independent.
 */
function attachReader(socket: Socket): Reader {
  let buf = Buffer.alloc(0);
  let closed = false;
  const waiters: {
    n: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }[] = [];

  const pump = (): void => {
    while (waiters.length > 0 && buf.length >= waiters[0]!.n) {
      const waiter = waiters.shift()!;
      waiter.resolve(buf.subarray(0, waiter.n));
      buf = buf.subarray(waiter.n);
    }
    if (closed) {
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error(`socket closed with ${buf.length}/${waiter.n} bytes buffered`));
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    pump();
  });
  socket.once('close', () => {
    closed = true;
    pump();
  });

  return {
    read(n) {
      return new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${n} bytes`)), 2000);
        timer.unref();
        waiters.push({
          n,
          resolve: (b) => {
            clearTimeout(timer);
            resolve(b);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        pump();
      });
    },
  };
}

function connectTo(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Connect, register for cleanup, and attach a buffering reader. */
async function open(port: number): Promise<{ socket: Socket; reader: Reader }> {
  const socket = await connectTo(port);
  openSockets.push(socket);
  return { socket, reader: attachReader(socket) };
}

function socksRequest(host: string, port: number): Buffer {
  const hostBuf = Buffer.from(host, 'utf8');
  const buf = Buffer.alloc(5 + hostBuf.length + 2);
  buf[0] = 0x05;
  buf[1] = 0x01;
  buf[2] = 0x00;
  buf[3] = 0x03;
  buf[4] = hostBuf.length;
  hostBuf.copy(buf, 5);
  buf.writeUInt16BE(port, 5 + hostBuf.length);
  return buf;
}

const GREETING = Buffer.from([0x05, 0x01, 0x00]);

const openHandles: PortForwardHandle[] = [];
const openSockets: Socket[] = [];

async function start(
  client: FakeClient,
  config: Omit<PortForwardingConfig, 'id'> & { id?: string },
): Promise<PortForwardHandle> {
  const handle = await startPortForward(asClient(client), {
    id: 'pf-test',
    ...config,
  } as PortForwardingConfig);
  openHandles.push(handle);
  return handle;
}

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.destroy();
  for (const handle of openHandles.splice(0)) await handle.close().catch(() => {});
});

describe('local forward', () => {
  it('binds, bridges traffic to the SSH channel, and counts bytes both ways', async () => {
    const client = new FakeClient();
    const port = await freePort();
    const handle = await start(client, {
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: port,
      remoteHost: 'db.internal',
      remotePort: 5432,
    });

    const { socket, reader } = await open(port);
    socket.write('ping');
    // The fake channel echoes, so a round trip proves both pipe directions.
    await expect(reader.read(4)).resolves.toEqual(Buffer.from('ping'));

    expect(client.forwardOutCalls).toEqual([{ destHost: 'db.internal', destPort: 5432 }]);
    expect(handle.bytesRead).toBe(4);
    expect(handle.bytesWritten).toBe(4);
  });

  it('tracks active connections up and back down', async () => {
    const client = new FakeClient();
    const port = await freePort();
    const handle = await start(client, {
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: port,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    });

    expect(handle.activeConnections).toBe(0);
    const { socket } = await open(port);
    await vi.waitFor(() => expect(handle.activeConnections).toBe(1));

    socket.destroy();
    await vi.waitFor(() => expect(handle.activeConnections).toBe(0));
  });

  it('does not lose bytes written before the SSH channel is ready', async () => {
    // The socket is paused until forwardOut's callback fires; without that,
    // the 'data' listener installed for byte-counting consumes anything sent
    // in the gap and drops it on the floor.
    const client = new FakeClient();
    const port = await freePort();
    await start(client, {
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: port,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    });

    const { socket, reader } = await open(port);
    socket.write('immediately-after-connect');
    await expect(reader.read(25)).resolves.toEqual(Buffer.from('immediately-after-connect'));
  });

  it('destroys the client socket when forwardOut fails', async () => {
    const client = new FakeClient();
    client.forwardOutError = new Error('channel open failure');
    const port = await freePort();
    await start(client, {
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: port,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    });

    const { socket } = await open(port);
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(socket.destroyed).toBe(true);
  });

  it('rejects with an actionable error when the port is already bound', async () => {
    // The whole reason start() is async: a handle that reports status
    // 'active' while the bind silently failed is worse than an error.
    const port = await freePort();
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(port, '127.0.0.1', resolve));
    try {
      await expect(
        start(new FakeClient(), {
          type: 'local',
          bindAddress: '127.0.0.1',
          localPort: port,
          remoteHost: '127.0.0.1',
          remotePort: 80,
        }),
      ).rejects.toThrow(/already in use/);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it('close() tears down live connections and stops accepting new ones', async () => {
    // server.close() alone only stops new accepts and waits for existing
    // connections to end — which for a tunnel is never.
    const client = new FakeClient();
    const port = await freePort();
    const handle = await start(client, {
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: port,
      remoteHost: '127.0.0.1',
      remotePort: 80,
    });

    const { socket } = await open(port);
    await vi.waitFor(() => expect(handle.activeConnections).toBe(1));

    // The client end learns about the teardown asynchronously; what close()
    // guarantees is that the *server* end was destroyed rather than left
    // waiting for a peer that will never hang up.
    const clientClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await handle.close();
    await clientClosed;
    await expect(connectTo(port)).rejects.toThrow();
  });
});

describe('dynamic (SOCKS5) forward', () => {
  /** Complete the greeting + request exchange and return the connected socket. */
  async function socksConnect(
    port: number,
    host: string,
    destPort: number,
    write: (socket: Socket, buf: Buffer) => void = (s, b) => {
      s.write(b);
    },
  ): Promise<{ socket: Socket; reader: Reader }> {
    const { socket, reader } = await open(port);
    write(socket, GREETING);
    await expect(reader.read(2)).resolves.toEqual(Buffer.from([0x05, 0x00]));
    write(socket, socksRequest(host, destPort));
    const reply = await reader.read(10);
    expect(reply[0]).toBe(0x05);
    expect(reply[1]).toBe(0x00);
    return { socket, reader };
  }

  it('completes a handshake delivered in one write and then tunnels data', async () => {
    const client = new FakeClient();
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const { socket, reader } = await socksConnect(port, 'example.com', 443);
    expect(client.forwardOutCalls).toEqual([{ destHost: 'example.com', destPort: 443 }]);

    socket.write('tunnelled');
    await expect(reader.read(9)).resolves.toEqual(Buffer.from('tunnelled'));
  });

  // The regression that motivated the rewrite: the old parser read fixed
  // offsets off a single 'data' chunk, so any fragmentation crashed the
  // main process with a RangeError.
  it('completes a handshake delivered one byte at a time', async () => {
    const client = new FakeClient();
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const byteAtATime = (socket: Socket, buf: Buffer): void => {
      for (const byte of buf) socket.write(Buffer.from([byte]));
    };

    const { socket, reader } = await socksConnect(port, 'fragmented.example', 8080, byteAtATime);
    expect(client.forwardOutCalls).toEqual([{ destHost: 'fragmented.example', destPort: 8080 }]);
    socket.write('ok');
    await expect(reader.read(2)).resolves.toEqual(Buffer.from('ok'));
  });

  it('forwards bytes that arrive glued to the end of the request', async () => {
    const client = new FakeClient();
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const { socket, reader } = await open(port);
    socket.write(GREETING);
    await reader.read(2);
    // Request and payload in a single segment — the payload belongs to the
    // tunnel, not the handshake.
    socket.write(Buffer.concat([socksRequest('example.com', 80), Buffer.from('GET /')]));
    await reader.read(10);
    await expect(reader.read(5)).resolves.toEqual(Buffer.from('GET /'));
  });

  it('replies host-unreachable and closes when forwardOut fails', async () => {
    const client = new FakeClient();
    client.forwardOutError = new Error('no route');
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const { socket, reader } = await open(port);
    socket.write(GREETING);
    await reader.read(2);
    socket.write(socksRequest('unreachable.example', 80));

    const reply = await reader.read(10);
    expect(reply[1]).toBe(0x04); // HOST_UNREACHABLE
  });

  it.each([
    ['a SOCKS4 greeting', Buffer.from([0x04, 0x01, 0x00])],
    ['random binary', Buffer.from([0xff, 0xfe, 0xfd, 0xfc])],
    ['a plain HTTP request', Buffer.from('GET / HTTP/1.1\r\n\r\n')],
  ])('drops the connection on %s without crashing the process', async (_label, payload) => {
    const client = new FakeClient();
    const port = await freePort();
    const handle = await start(client, {
      type: 'dynamic',
      bindAddress: '127.0.0.1',
      localPort: port,
    });

    const { socket } = await open(port);
    socket.write(payload);
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));

    // The listener survives — one hostile client must not take the proxy down.
    expect(handle.status).toBe('active');
    const { socket: second } = await open(port);
    expect(second.destroyed).toBe(false);
  });

  it('refuses a CONNECT to port 0 rather than forwarding it', async () => {
    const client = new FakeClient();
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const { socket, reader } = await open(port);
    socket.write(GREETING);
    await reader.read(2);
    socket.write(socksRequest('example.com', 0));

    const reply = await reader.read(10);
    expect(reply[1]).not.toBe(0x00);
    expect(client.forwardOutCalls).toHaveLength(0);
  });

  it('drops a client that floods the handshake without ever completing it', async () => {
    // Unbounded buffering of a never-valid handshake is a memory-growth vector.
    const client = new FakeClient();
    const port = await freePort();
    await start(client, { type: 'dynamic', bindAddress: '127.0.0.1', localPort: port });

    const { socket, reader } = await open(port);
    socket.write(GREETING);
    await reader.read(2);
    // Claim a 200-byte domain, then never send it — just filler forever.
    socket.write(Buffer.from([0x05, 0x01, 0x00, 0x03, 200]));
    for (let i = 0; i < 10; i++) socket.write(Buffer.alloc(1024, 0x41));

    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(socket.destroyed).toBe(true);
  });
});

describe('remote forward', () => {
  it('rejects when the server refuses the requested bind', async () => {
    const client = new FakeClient();
    client.forwardInError = new Error('administratively prohibited');
    await expect(
      start(client, {
        type: 'remote',
        bindAddress: '127.0.0.1',
        localPort: 9090,
        remoteHost: '127.0.0.1',
        remotePort: 3000,
      }),
    ).rejects.toThrow(/refused to listen/);
  });

  it('unforwards and detaches its listener on close', async () => {
    const client = new FakeClient();
    const handle = await start(client, {
      type: 'remote',
      bindAddress: '127.0.0.1',
      localPort: 9091,
      remoteHost: '127.0.0.1',
      remotePort: 3000,
    });
    expect(client.listenerCount('tcp connection')).toBe(1);

    await handle.close();
    expect(client.unforwardInCalls).toEqual([{ host: '127.0.0.1', port: 9091 }]);
    // A stale listener would keep answering channel-open requests for a
    // forward the user already stopped.
    expect(client.listenerCount('tcp connection')).toBe(0);
  });

  it('bridges an inbound channel to the configured local destination', async () => {
    // A *sink*, deliberately not an echo: the fake channel is a PassThrough,
    // so pairing it with an echoing destination would loop the same bytes
    // between the two forever.
    const received: Buffer[] = [];
    const sinkConnections = new Set<Socket>();
    const sink = createServer((socket) => {
      sinkConnections.add(socket);
      socket.on('data', (chunk: Buffer) => received.push(chunk));
      socket.on('error', () => socket.destroy());
      socket.on('close', () => sinkConnections.delete(socket));
    });
    const destPort = await freePort();
    await new Promise<void>((resolve) => sink.listen(destPort, '127.0.0.1', resolve));

    try {
      const client = new FakeClient();
      const handle = await start(client, {
        type: 'remote',
        bindAddress: '127.0.0.1',
        localPort: 9092,
        remoteHost: '127.0.0.1',
        remotePort: destPort,
      });

      const channel = new PassThrough();
      client.emit(
        'tcp connection',
        { destPort: 9092 },
        () => channel,
        () => {},
      );

      await vi.waitFor(() => expect(handle.activeConnections).toBe(1));
      channel.write('via-remote');

      await vi.waitFor(() => {
        expect(Buffer.concat(received).toString()).toBe('via-remote');
      });
      expect(handle.bytesWritten).toBe(10);
    } finally {
      // server.close() only stops new accepts and waits for existing
      // connections to end — the forward is still holding one, so drop it
      // explicitly or this hangs forever.
      for (const socket of sinkConnections) socket.destroy();
      await new Promise<void>((resolve) => sink.close(() => resolve()));
    }
  });

  it('ignores inbound channels for a different port', async () => {
    const client = new FakeClient();
    const handle = await start(client, {
      type: 'remote',
      bindAddress: '127.0.0.1',
      localPort: 9093,
      remoteHost: '127.0.0.1',
      remotePort: 3000,
    });

    const accept = vi.fn();
    client.emit('tcp connection', { destPort: 9999 }, accept, () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(accept).not.toHaveBeenCalled();
    expect(handle.activeConnections).toBe(0);
  });
});
