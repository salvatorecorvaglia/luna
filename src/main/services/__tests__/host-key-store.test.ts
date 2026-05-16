import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatHostKey, updateHostKey, verifyHostKey } from '../host-key-store';

// In-memory shim of the subset of better-sqlite3 used by host-key-store.
// We avoid loading the native module here because its ABI is compiled for
// Electron's Node version, not the test runner's.
type Row = { host_key: string; algorithm: string; fingerprint: string; first_seen: number };
const table = new Map<string, Row>();

const fakeDb = {
  prepare(sql: string) {
    if (sql.startsWith('SELECT fingerprint, algorithm FROM known_hosts WHERE host_key = ?')) {
      return {
        get: (hostKey: string) => {
          const row = table.get(hostKey);
          return row ? { fingerprint: row.fingerprint, algorithm: row.algorithm } : undefined;
        },
      };
    }
    if (sql.includes('INSERT INTO known_hosts') && sql.includes('ON CONFLICT')) {
      return {
        run: (hostKey: string, algorithm: string, fingerprint: string) => {
          table.set(hostKey, { host_key: hostKey, algorithm, fingerprint, first_seen: 0 });
        },
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};

vi.mock('../database', () => ({ getDatabase: () => fakeDb }));

beforeEach(() => {
  table.clear();
});

describe('host-key-store TOFU', () => {
  it('signals first-use (untrusted) for a never-seen host', () => {
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-ed25519');
    expect(result).toEqual({ trusted: false, changed: false, isFirst: true });
    // Should NOT auto-store — explicit trust via updateHostKey is required.
    expect(table.has('host:22')).toBe(false);
  });

  it('trusts the same key on subsequent encounters once stored', () => {
    updateHostKey('host', 22, Buffer.from('key-1'), 'ssh-ed25519');
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-ed25519');
    expect(result).toEqual({ trusted: true, changed: false, isFirst: false });
  });

  it('rejects when the key changes (possible MITM)', () => {
    updateHostKey('host', 22, Buffer.from('original'), 'ssh-ed25519');
    const result = verifyHostKey('host', 22, Buffer.from('different'), 'ssh-ed25519');
    expect(result).toEqual({ trusted: false, changed: true, isFirst: false });
  });

  it('updateHostKey overwrites the stored fingerprint', () => {
    updateHostKey('host', 22, Buffer.from('original'), 'ssh-ed25519');
    updateHostKey('host', 22, Buffer.from('new-key'), 'ssh-ed25519');
    const result = verifyHostKey('host', 22, Buffer.from('new-key'), 'ssh-ed25519');
    expect(result.trusted).toBe(true);
  });

  it('treats different ports as different hosts', () => {
    updateHostKey('host', 22, Buffer.from('k22'), 'ssh-ed25519');
    const onPort2222 = verifyHostKey('host', 2222, Buffer.from('k2222'), 'ssh-ed25519');
    expect(onPort2222).toEqual({ trusted: false, changed: false, isFirst: true });
  });

  it('refuses to persist weak/deprecated algorithms via updateHostKey', () => {
    // The trust path must never store a weak algorithm — even if a future
    // prompt-side regression surfaces one. Hard policy in the store itself.
    expect(() => updateHostKey('host', 22, Buffer.from('key-1'), 'ssh-rsa')).toThrow(/ssh-rsa/);
    // And verify() still rejects the weak algo on the wire, regardless of
    // whether anything is stored.
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-rsa');
    expect(result).toEqual({
      trusted: false,
      changed: false,
      isFirst: false,
      weakAlgorithm: true,
    });
  });

  it('rejects ssh-dss as weak', () => {
    const result = verifyHostKey('host', 22, Buffer.from('key-1'), 'ssh-dss');
    expect(result.trusted).toBe(false);
    expect(result.weakAlgorithm).toBe(true);
  });
});

describe('formatHostKey (IPv6 disambiguation)', () => {
  it('passes IPv4 hostnames through unchanged', () => {
    expect(formatHostKey('192.168.1.1', 22)).toBe('192.168.1.1:22');
    expect(formatHostKey('example.com', 2222)).toBe('example.com:2222');
  });

  it('brackets IPv6 addresses so the port separator is unambiguous', () => {
    expect(formatHostKey('::1', 22)).toBe('[::1]:22');
    expect(formatHostKey('2001:db8::1', 22)).toBe('[2001:db8::1]:22');
  });

  it('does not double-bracket already-bracketed input', () => {
    expect(formatHostKey('[::1]', 22)).toBe('[::1]:22');
  });
});

describe('host-key-store IPv6', () => {
  it('stores and retrieves an IPv6 host without colliding with another IPv6 on a different port', () => {
    updateHostKey('::1', 22, Buffer.from('a'), 'ssh-ed25519');
    updateHostKey('::1', 2222, Buffer.from('b'), 'ssh-ed25519');
    expect(verifyHostKey('::1', 22, Buffer.from('a'), 'ssh-ed25519').trusted).toBe(true);
    expect(verifyHostKey('::1', 2222, Buffer.from('b'), 'ssh-ed25519').trusted).toBe(true);
    // Cross-check: key for 22 must NOT trust on 2222.
    expect(verifyHostKey('::1', 2222, Buffer.from('a'), 'ssh-ed25519').changed).toBe(true);
  });

  it("does not confuse IPv6 host '::' port 1 with host '::1' port (none) — separator is unambiguous", () => {
    updateHostKey('::', 1, Buffer.from('host-colon'), 'ssh-ed25519');
    // The ambiguous legacy format `::1` could be either; the new format is
    // `[::]:1` vs `[::1]:22` — distinct primary keys.
    const v = verifyHostKey('::1', 22, Buffer.from('host-colon'), 'ssh-ed25519');
    expect(v.isFirst).toBe(true);
  });
});
