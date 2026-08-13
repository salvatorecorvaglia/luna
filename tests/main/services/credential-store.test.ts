import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Set up a per-test userData dir so safeStorage / on-disk key writes don't
// collide between runs. Mock electron *before* importing the module under test.
const userData = mkdtempSync(join(tmpdir(), 'luna-cred-'));

// Simulate a working OS keyring (macOS Keychain / Linux libsecret) so the
// credential store has an encrypted key path to exercise. The credential-store
// now refuses to persist a plaintext master key when safeStorage is missing
// , so a `false` mock here would be testing the refusal, not the crypto.
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString('utf-8').replace(/^enc:/, ''),
  },
}));

// In-memory stand-in for the credentials table so the tamper-detection path
// (store → retrieve → decrypt-failure → emit) can be exercised end-to-end.
const credentialRows = new Map<string, Buffer>();
vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => ({
    exec: () => {},
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (/^INSERT/i.test(sql)) {
          credentialRows.set(args[0] as string, args[1] as Buffer);
        } else if (/^DELETE/i.test(sql)) {
          credentialRows.delete(args[0] as string);
        }
      },
      get: (id: string) => {
        const row = credentialRows.get(id);
        return row ? { encrypted_data: row } : undefined;
      },
    }),
  }),
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  __test__,
  type CredentialTamperEvent,
  deleteCredential,
  onCredentialTamper,
  retrieveCredential,
  storeCredential,
} from '../../../src/main/services/credential-store';

beforeEach(() => {
  // The module caches the encryption key after first use; that's fine for
  // round-trip tests since both encrypt and decrypt see the same key.
});

describe('credential-store encryption', () => {
  it('round-trips a UTF-8 secret', () => {
    const plaintext = 'p@ssw0rd! — with unicode ✨';
    const sealed = __test__.encrypt(plaintext);
    expect(sealed).toBeInstanceOf(Buffer);
    expect(sealed.toString('utf-8')).not.toContain(plaintext);
    expect(__test__.decrypt(sealed)).toBe(plaintext);
  });

  it('produces unique ciphertext for the same input (random IV)', () => {
    const a = __test__.encrypt('same');
    const b = __test__.encrypt('same');
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('detects tampering via the GCM auth tag', () => {
    const sealed = __test__.encrypt('truth');
    const tampered = Buffer.from(sealed);
    // Flip a byte in the ciphertext region (after IV [12] + tag [16]).
    tampered[28] ^= 0xff;
    expect(() => __test__.decrypt(tampered)).toThrow();
  });

  it('rejects truncated ciphertext', () => {
    const sealed = __test__.encrypt('truth');
    const truncated = sealed.subarray(0, sealed.length - 1);
    expect(() => __test__.decrypt(truncated)).toThrow();
  });

  it('rejects ciphertext shorter than IV+tag with an explicit length error', () => {
    // 27 bytes — one short of the IV (12) + auth tag (16) prefix. The
    // defensive length check should fire before OpenSSL surfaces an opaque
    // "Unsupported state" error.
    const tooShort = Buffer.alloc(27);
    expect(() => __test__.decrypt(tooShort)).toThrow(/ciphertext too short/);
  });

  it('rejects an empty buffer', () => {
    expect(() => __test__.decrypt(Buffer.alloc(0))).toThrow(/ciphertext too short/);
  });
});

describe('credential-store tamper detection', () => {
  beforeEach(() => {
    credentialRows.clear();
  });

  it('emits onCredentialTamper when a stored credential fails to decrypt', () => {
    const events: CredentialTamperEvent[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    try {
      storeCredential('conn-1', 'secret');
      // Flip a byte in the ciphertext to invalidate the GCM auth tag.
      const sealed = credentialRows.get('conn-1')!;
      const tampered = Buffer.from(sealed);
      tampered[tampered.length - 1] ^= 0xff;
      credentialRows.set('conn-1', tampered);

      const result = retrieveCredential('conn-1');
      expect(result).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0].connectionId).toBe('conn-1');
      expect(events[0].reason).toMatch(/auth|unable|tag/i);
      expect(typeof events[0].at).toBe('number');
    } finally {
      unsubscribe();
    }
  });

  it('drops the tampered row so the user is prompted to re-enter', () => {
    const unsubscribe = onCredentialTamper(() => {});
    try {
      storeCredential('conn-2', 'secret');
      const sealed = credentialRows.get('conn-2')!;
      const tampered = Buffer.from(sealed);
      tampered[tampered.length - 1] ^= 0xff;
      credentialRows.set('conn-2', tampered);

      retrieveCredential('conn-2');
      expect(credentialRows.has('conn-2')).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it('unsubscribe stops further tamper notifications', () => {
    const events: CredentialTamperEvent[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    unsubscribe();

    storeCredential('conn-3', 'secret');
    const sealed = credentialRows.get('conn-3')!;
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    credentialRows.set('conn-3', tampered);

    retrieveCredential('conn-3');
    expect(events).toHaveLength(0);
  });

  it('returns the secret untouched on the happy path (no tamper event)', () => {
    const events: CredentialTamperEvent[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    try {
      storeCredential('conn-4', 'hello');
      expect(retrieveCredential('conn-4')).toBe('hello');
      expect(events).toHaveLength(0);
      deleteCredential('conn-4');
      expect(retrieveCredential('conn-4')).toBeNull();
    } finally {
      unsubscribe();
    }
  });
});

// Cleanup tmp dir at end of run.
afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
