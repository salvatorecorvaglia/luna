import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates: { host: string; port: number; key: Buffer; algorithm: string }[] = [];

vi.mock('../../host-key-store', () => ({
  formatHostKey: (host: string, port: number) => `${host}:${port}`,
  fingerprintKey: (key: Buffer) => `sha256:${key.toString('hex').slice(0, 8)}`,
  isAllowedHostKeyAlgorithm: (algo: string) => algo !== 'ssh-dss' && algo !== 'unknown',
  updateHostKey: (host: string, port: number, key: Buffer, algorithm: string) => {
    updates.push({ host, port, key, algorithm });
  },
}));

import { PendingHostKeyRegistry, parseHostKeyAlgorithm } from '../host-key-flow';

beforeEach(() => {
  updates.length = 0;
});

describe('parseHostKeyAlgorithm', () => {
  it('extracts the algorithm name from a well-formed wire-format key', () => {
    const algo = 'ssh-ed25519';
    const buf = Buffer.alloc(4 + algo.length + 8);
    buf.writeUInt32BE(algo.length, 0);
    buf.write(algo, 4, 'ascii');
    expect(parseHostKeyAlgorithm(buf)).toBe(algo);
  });

  it('returns "unknown" when the buffer is too short for a length prefix', () => {
    expect(parseHostKeyAlgorithm(Buffer.from([0, 1]))).toBe('unknown');
  });

  it('returns "unknown" when the declared length is zero', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(0, 0);
    expect(parseHostKeyAlgorithm(buf)).toBe('unknown');
  });

  it('returns "unknown" when the declared length exceeds the cap', () => {
    const buf = Buffer.alloc(80);
    buf.writeUInt32BE(70, 0);
    expect(parseHostKeyAlgorithm(buf)).toBe('unknown');
  });

  it('returns "unknown" when the buffer is shorter than the declared length', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(20, 0);
    expect(parseHostKeyAlgorithm(buf)).toBe('unknown');
  });
});

describe('PendingHostKeyRegistry', () => {
  it('returns null when trusting a host that was never remembered', () => {
    const reg = new PendingHostKeyRegistry();
    expect(reg.trust('host', 22)).toBeNull();
  });

  it('persists a captured key and returns its fingerprint when trusted', () => {
    const reg = new PendingHostKeyRegistry();
    const key = Buffer.from('aabbccdd', 'hex');
    reg.remember('host', 22, key, 'ssh-ed25519');

    const fingerprint = reg.trust('host', 22);

    expect(fingerprint).toBe('sha256:aabbccdd');
    expect(updates).toEqual([{ host: 'host', port: 22, key, algorithm: 'ssh-ed25519' }]);
  });

  it('clears the candidate after a successful trust so a second call returns null', () => {
    const reg = new PendingHostKeyRegistry();
    reg.remember('host', 22, Buffer.from('aa', 'hex'), 'ssh-ed25519');
    reg.trust('host', 22);
    expect(reg.trust('host', 22)).toBeNull();
  });

  it('keeps a defensive copy of the key buffer', () => {
    const reg = new PendingHostKeyRegistry();
    const key = Buffer.from('aabb', 'hex');
    reg.remember('host', 22, key, 'ssh-ed25519');
    key[0] = 0xff;
    reg.trust('host', 22);
    expect(updates[0].key.toString('hex')).toBe('aabb');
  });

  it('refreshes LRU order so re-remembered entries survive eviction', () => {
    const reg = new PendingHostKeyRegistry();
    // Fill to the cap, then re-touch the oldest, then insert one more.
    // The re-touched entry must survive while the next-oldest is evicted.
    const MAX = 64;
    for (let i = 0; i < MAX; i++) {
      reg.remember(`h${i}`, 22, Buffer.from([i]), 'ssh-ed25519');
    }
    // Re-touch h0 → moves to MRU end
    reg.remember('h0', 22, Buffer.from([0]), 'ssh-ed25519');
    // Insert one more → should evict h1, not h0
    reg.remember('h64', 22, Buffer.from([64]), 'ssh-ed25519');

    expect(reg.trust('h0', 22)).not.toBeNull();
    expect(reg.trust('h1', 22)).toBeNull();
    expect(reg.trust('h64', 22)).not.toBeNull();
  });

  it('remember() refuses to store a candidate with a disallowed algorithm', () => {
    const reg = new PendingHostKeyRegistry();
    const stored = reg.remember('host', 22, Buffer.from('aa', 'hex'), 'ssh-dss');
    expect(stored).toBe(false);
    // The candidate was never stored, so trust() finds nothing — no committed update.
    expect(reg.trust('host', 22)).toBeNull();
    expect(updates).toEqual([]);
  });

  it('remember() returns true for allowed algorithms', () => {
    const reg = new PendingHostKeyRegistry();
    expect(reg.remember('host', 22, Buffer.from('aa', 'hex'), 'ssh-ed25519')).toBe(true);
  });

  it('forget() drops a candidate without trusting it', () => {
    const reg = new PendingHostKeyRegistry();
    reg.remember('host', 22, Buffer.from('aa', 'hex'), 'ssh-ed25519');
    reg.forget('host', 22);
    expect(reg.trust('host', 22)).toBeNull();
    expect(updates).toEqual([]);
  });
});
