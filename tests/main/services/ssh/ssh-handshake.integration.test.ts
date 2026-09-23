/**
 * Integration smoke test against an in-process ssh2.Server. Validates that
 * the buildConnectConfig helper produces a config the real ssh2.Client can
 * use to complete a handshake — exercises the verifier callback and the
 * password-auth path end-to-end without the unit-test mocks.
 *
 * Deliberately scoped to one full handshake. Per-feature integration
 * coverage (TOFU mismatch, reconnect backoff, key auth) is deferred —
 * see docs-internal/DEFERRED_WORK.md.
 */

import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo, createServer } from 'node:net';
import { Client, Server, type ServerConfig } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/main/services/database', () => ({
  // ssh-config reads keepalive + readyTimeout; provide tight defaults so the
  // test fails fast on a hung handshake instead of waiting 30s.
  getSetting: (_key: string, dflt: number) => dflt,
}));

vi.mock('../../../../src/main/services/host-key-store', () => ({
  // For this test we accept the first key we see, so the verifier returns
  // {trusted: true} immediately and we don't need to wire the host-key DB.
  verifyHostKey: () => ({ trusted: true, changed: false, isFirst: true }),
  getStoredHostKey: () => null,
  fingerprintKey: (key: Buffer) => `sha256:${key.toString('hex').slice(0, 8)}`,
  formatHostKey: (host: string, port: number) => `${host}:${port}`,
}));

vi.mock('../../../../src/main/services/credential-store', () => ({
  retrieveCredential: () => undefined,
}));

vi.mock('../../../../src/main/services/emit', () => ({
  emitToRenderer: vi.fn(),
}));

vi.mock('../../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PendingHostKeyRegistry } from '../../../../src/main/services/ssh/host-key-flow';
import { buildConnectConfig } from '../../../../src/main/services/ssh/ssh-config';

// Generate an ephemeral host key for the test server. ssh2's Server only
// accepts PEM-format keys; export accordingly.
const { privateKey: hostKeyPem } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

let server: Server;
let port: number;

beforeAll(async () => {
  const config: ServerConfig = {
    hostKeys: [hostKeyPem],
  };
  server = new Server(config, (client) => {
    client.on('authentication', (ctx) => {
      // Accept any password from user "tester" — we only validate the
      // handshake reaches here, not the auth machinery itself.
      if (ctx.method === 'password' && ctx.username === 'tester') {
        ctx.accept();
      } else if (ctx.method === 'none') {
        ctx.reject(['password'], false);
      } else {
        ctx.reject();
      }
    });
    client.on('ready', () => {
      // Close the connection cleanly after the handshake — that's all the
      // test needs to assert.
      client.end();
    });
  });
  // Ephemeral port via the underlying net server.
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = (
        server as unknown as { _srv: ReturnType<typeof createServer> }
      )._srv.address() as AddressInfo;
      port = addr.port;
      resolve();
    });
    server.on('error', reject);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('ssh handshake — integration against fake-sshd', () => {
  it('completes a password-auth handshake using buildConnectConfig output', async () => {
    const { config, error } = await buildConnectConfig(
      {
        host: '127.0.0.1',
        port,
        username: 'tester',
        authType: 'password',
        password: 'doesnt-matter',
      },
      { pendingHostKeys: new PendingHostKeyRegistry() },
    );
    expect(error).toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('handshake did not complete within 5s'));
      }, 5000);
      client
        .on('ready', () => {
          clearTimeout(timeout);
          client.end();
          resolve();
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        })
        .connect(config);
    });
  });

  it('rejects when the username is wrong (server returns auth failure)', async () => {
    const { config } = await buildConnectConfig(
      {
        host: '127.0.0.1',
        port,
        username: 'wrong-user',
        authType: 'password',
        password: 'pw',
      },
      { pendingHostKeys: new PendingHostKeyRegistry() },
    );

    await new Promise<void>((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('expected an auth failure but neither error nor ready fired'));
      }, 5000);
      client
        .on('ready', () => {
          clearTimeout(timeout);
          client.end();
          reject(new Error('handshake unexpectedly succeeded for wrong user'));
        })
        .on('error', () => {
          clearTimeout(timeout);
          // The exact message from ssh2 varies by version (e.g. "All
          // configured authentication methods failed"); we just assert
          // the client surfaces a failure, which is what callers rely on.
          resolve();
        })
        .connect(config);
    });
  });
});
