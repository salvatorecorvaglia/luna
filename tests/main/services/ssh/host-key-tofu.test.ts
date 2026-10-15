/**
 * Covers the TOFU end-to-end flow at the boundary the audit flagged:
 *   first-connect → hostVerifier rejects → SSH_ON_HOST_KEY_CHANGE event →
 *   user trusts → trust() commits the captured key.
 *
 * The full ssh2-handshake-against-fake-sshd integration test in
 * `ssh-handshake.integration.test.ts` mocks `verifyHostKey` to always return
 * `trusted: true`, so the rejection path was previously untested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emits: { channel: string; payload: unknown }[] = [];
const stored: { host: string; port: number; key: Buffer; algorithm: string }[] = [];
let verifyResult: { trusted: boolean; isFirst?: boolean; weakAlgorithm?: boolean } = {
  trusted: true,
};

vi.mock('../../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../src/main/services/database', () => ({
  getSetting: (_k: string, dflt: number) => dflt,
}));

vi.mock('../../../../src/main/services/emit', () => ({
  emitToRenderer: (channel: string, payload: unknown) => {
    emits.push({ channel, payload });
  },
}));

vi.mock('../../../../src/main/services/credential-store', () => ({
  retrieveCredential: () => undefined,
}));

vi.mock('../../../../src/main/services/host-key-store', () => ({
  verifyHostKey: () => verifyResult,
  getStoredHostKey: () => null,
  fingerprintKey: (key: Buffer) => `SHA256:${key.toString('hex').slice(0, 12)}`,
  formatHostKey: (host: string, port: number) => `${host}:${port}`,
  isAllowedHostKeyAlgorithm: (algo: string) => algo !== 'ssh-dss',
  updateHostKey: (host: string, port: number, key: Buffer, algorithm: string) => {
    stored.push({ host, port, key, algorithm });
  },
}));

import { PendingHostKeyRegistry } from '../../../../src/main/services/ssh/host-key-flow';
import { buildConnectConfig } from '../../../../src/main/services/ssh/ssh-config';

/** Construct a minimal wire-format key buffer whose first field is the algorithm. */
function makeKey(algorithm: string, suffix: string): Buffer {
  const algoBuf = Buffer.from(algorithm, 'ascii');
  const suffixBuf = Buffer.from(suffix, 'utf8');
  const buf = Buffer.alloc(4 + algoBuf.length + suffixBuf.length);
  buf.writeUInt32BE(algoBuf.length, 0);
  algoBuf.copy(buf, 4);
  suffixBuf.copy(buf, 4 + algoBuf.length);
  return buf;
}

beforeEach(() => {
  emits.length = 0;
  stored.length = 0;
  verifyResult = { trusted: true };
});

describe('host-key TOFU flow via hostVerifier', () => {
  it('first-connect: verifier returns false, remembers key, emits host-key-change', async () => {
    verifyResult = { trusted: false, isFirst: true };
    const pending = new PendingHostKeyRegistry();
    const { config } = await buildConnectConfig(
      {
        host: 'host.example',
        port: 22,
        username: 'u',
        authType: 'password',
        password: 'p',
      },
      { pendingHostKeys: pending, sessionId: 'sess-1', connectionId: 'conn-1' },
    );
    const verifier = config.hostVerifier as (key: Buffer) => boolean;
    const key = makeKey('ssh-ed25519', 'abcd');

    const ok = verifier(key);

    expect(ok).toBe(false);
    const change = emits.find((e) => e.channel.includes('host-key-change'));
    expect(change?.payload).toMatchObject({
      sessionId: 'sess-1',
      connectionId: 'conn-1',
      host: 'host.example',
      port: 22,
      algorithm: 'ssh-ed25519',
      isFirst: true,
    });
    // After verifier rejects, the candidate is in pending and trust() commits it.
    const fp = pending.trust('host.example', 22, `SHA256:${key.toString('hex').slice(0, 12)}`);
    expect(fp).toMatch(/^SHA256:/);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      host: 'host.example',
      port: 22,
      algorithm: 'ssh-ed25519',
    });
  });

  it('mismatch (changed): verifier rejects with a message distinct from first-connect', async () => {
    verifyResult = { trusted: false, isFirst: false };
    const pending = new PendingHostKeyRegistry();
    const { config } = await buildConnectConfig(
      { host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' },
      { pendingHostKeys: pending, sessionId: 's', connectionId: 'c' },
    );
    const verifier = config.hostVerifier as (key: Buffer) => boolean;
    expect(verifier(makeKey('ssh-ed25519', 'xx'))).toBe(false);
    const err = emits.find((e) => e.channel.includes('on-error'));
    expect(err?.payload).toMatchObject({
      error: expect.stringMatching(/has changed/i),
    });
  });

  it('weak algorithm: verifier rejects without prompting (no host-key-change event)', async () => {
    verifyResult = { trusted: false, weakAlgorithm: true };
    const pending = new PendingHostKeyRegistry();
    const { config } = await buildConnectConfig(
      { host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' },
      { pendingHostKeys: pending, sessionId: 's' },
    );
    const verifier = config.hostVerifier as (key: Buffer) => boolean;
    expect(verifier(makeKey('ssh-dss', 'xx'))).toBe(false);
    // No host-key-change prompt — refusing weak algos is policy, not a TOFU choice.
    expect(emits.find((e) => e.channel.includes('host-key-change'))).toBeUndefined();
    // pending registry stays empty so trust() can't paper over the rejection.
    expect(pending.trust('h', 22, 'SHA256:any')).toBeNull();
  });

  it('trusted: verifier returns true and emits nothing', async () => {
    verifyResult = { trusted: true };
    const pending = new PendingHostKeyRegistry();
    const { config } = await buildConnectConfig(
      { host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' },
      { pendingHostKeys: pending, sessionId: 's' },
    );
    const verifier = config.hostVerifier as (key: Buffer) => boolean;
    expect(verifier(makeKey('ssh-ed25519', 'yy'))).toBe(true);
    expect(emits).toEqual([]);
  });

  it('never offers SHA-1 RSA or DSA signatures, which the ssh-rsa key-type allowlist relies on', async () => {
    // host-key-store allows the `ssh-rsa` *key type* because RSA blobs are
    // always typed that way. That is only safe while negotiation refuses the
    // SHA-1 `ssh-rsa` signature scheme — pin it.
    const { config } = await buildConnectConfig(
      { host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' },
      { pendingHostKeys: new PendingHostKeyRegistry() },
    );
    const offered = (config.algorithms?.serverHostKey ?? []) as string[];
    expect(offered).toContain('rsa-sha2-256');
    expect(offered).not.toContain('ssh-rsa');
    expect(offered).not.toContain('ssh-dss');
  });

  it('treats a stored keepalive of 0 as unset and falls back to the global interval', async () => {
    // Migration 016 defaults keepalive_interval to 0. Passing that through
    // disabled ssh2 keepalive for every saved connection.
    const { config } = await buildConnectConfig(
      {
        host: 'h',
        port: 22,
        username: 'u',
        authType: 'password',
        password: 'p',
        keepaliveInterval: 0,
        keepaliveCountMax: 0,
      },
      { pendingHostKeys: new PendingHostKeyRegistry() },
    );
    // getSetting is mocked to return its default here.
    expect(config.keepaliveInterval).toBe(10000);
    expect(config.keepaliveCountMax).toBe(3);
  });

  it('keeps an explicit per-connection keepalive', async () => {
    const { config } = await buildConnectConfig(
      {
        host: 'h',
        port: 22,
        username: 'u',
        authType: 'password',
        password: 'p',
        keepaliveInterval: 30000,
        keepaliveCountMax: 5,
      },
      { pendingHostKeys: new PendingHostKeyRegistry() },
    );
    expect(config.keepaliveInterval).toBe(30000);
    expect(config.keepaliveCountMax).toBe(5);
  });
});
