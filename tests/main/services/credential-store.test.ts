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
interface FakeCredentialRow {
  encrypted_data: Buffer;
  aad_version: number;
}

/**
 * Models both columns, including `aad_version`. Without it every stored row
 * reads back as v0 (no AAD) while storeCredential writes v1, so nothing
 * round-trips — the fake has to track the schema the code writes.
 */
const credentialRows = new Map<string, FakeCredentialRow>();
vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => ({
    exec: () => {},
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (/^INSERT/i.test(sql)) {
          credentialRows.set(args[0] as string, {
            encrypted_data: args[1] as Buffer,
            aad_version: (args[2] as number) ?? 0,
          });
        } else if (/^UPDATE/i.test(sql)) {
          // SET encrypted_data = ?, aad_version = ? WHERE connection_id = ?
          credentialRows.set(args[2] as string, {
            encrypted_data: args[0] as Buffer,
            aad_version: args[1] as number,
          });
        } else if (/^DELETE/i.test(sql)) {
          credentialRows.delete(args[0] as string);
        }
      },
      get: (id: string) => credentialRows.get(id),
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
    tampered[28]! ^= 0xff;
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
      const sealed = credentialRows.get('conn-1')!.encrypted_data;
      const tampered = Buffer.from(sealed);
      tampered[tampered.length - 1]! ^= 0xff;
      credentialRows.set('conn-1', { encrypted_data: tampered, aad_version: 1 });

      const result = retrieveCredential('conn-1');
      expect(result).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0]!.connectionId).toBe('conn-1');
      expect(events[0]!.reason).toMatch(/auth|unable|tag/i);
      expect(typeof events[0]!.at).toBe('number');
    } finally {
      unsubscribe();
    }
  });

  // Regression: this used to assert the opposite — that the row was DELETED.
  // Deleting turned a possibly-recoverable state into permanent data loss. A
  // decrypt failure does not prove tampering; the far more common cause is that
  // the master key could not be unwrapped (locked keyring), in which case every
  // credential decodes as "tampered" and the old behaviour wiped all of them.
  // Retention costs nothing: retrieve still returns null so the caller prompts
  // for re-entry, and storeCredential is INSERT OR REPLACE.
  it('keeps the tampered row instead of destroying it, and still reports null', () => {
    const unsubscribe = onCredentialTamper(() => {});
    try {
      storeCredential('conn-2', 'secret');
      const sealed = credentialRows.get('conn-2')!.encrypted_data;
      const tampered = Buffer.from(sealed);
      tampered[tampered.length - 1]! ^= 0xff;
      credentialRows.set('conn-2', { encrypted_data: tampered, aad_version: 1 });

      expect(retrieveCredential('conn-2')).toBeNull();
      expect(credentialRows.has('conn-2')).toBe(true);
      expect(credentialRows.get('conn-2')!.encrypted_data).toEqual(tampered);
    } finally {
      unsubscribe();
    }
  });

  it('unsubscribe stops further tamper notifications', () => {
    const events: CredentialTamperEvent[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    unsubscribe();

    storeCredential('conn-3', 'secret');
    const sealed = credentialRows.get('conn-3')!.encrypted_data;
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 0xff;
    credentialRows.set('conn-3', { encrypted_data: tampered, aad_version: 1 });

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

describe('credential-store AAD binding', () => {
  beforeEach(() => {
    credentialRows.clear();
  });

  /**
   * The attack the AAD closes. GCM authenticated the ciphertext but nothing
   * bound it to the row it lived in, so anyone able to write luna.db could move
   * a blob from one connection to another: the tag stayed valid, decryption
   * succeeded, and connection B authenticated with connection A's password —
   * with no tamper-log entry, because nothing was actually corrupt.
   */
  it('refuses a credential blob moved to a different connection', () => {
    storeCredential('conn-victim', 'victim-password');
    storeCredential('conn-attacker', 'attacker-password');

    const victimBlob = credentialRows.get('conn-victim')!;
    // Swap the victim's sealed blob into the attacker's row, version and all.
    credentialRows.set('conn-attacker', { ...victimBlob });

    expect(retrieveCredential('conn-attacker')).toBeNull();
    // The victim's own row is untouched and still works.
    expect(retrieveCredential('conn-victim')).toBe('victim-password');
  });

  it('reports a moved blob as a tamper event', () => {
    const events: CredentialTamperEvent[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    try {
      storeCredential('conn-a', 'secret-a');
      storeCredential('conn-b', 'secret-b');
      credentialRows.set('conn-b', { ...credentialRows.get('conn-a')! });

      retrieveCredential('conn-b');

      expect(events).toHaveLength(1);
      expect(events[0]!.connectionId).toBe('conn-b');
    } finally {
      unsubscribe();
    }
  });

  it('still reads a pre-migration row and rewrites it bound to its connection', () => {
    // aad_version 0 is the original format. Existing installs must keep working,
    // which is why the column defaults to 0 rather than the format being guessed
    // from the blob.
    const legacyBlob = __test__.encrypt('legacy-secret');
    credentialRows.set('conn-legacy', { encrypted_data: legacyBlob, aad_version: 0 });

    expect(retrieveCredential('conn-legacy')).toBe('legacy-secret');

    // Upgraded in place on read, so the window where a row is unbound closes on
    // first use rather than on next password change.
    const upgraded = credentialRows.get('conn-legacy')!;
    expect(upgraded.aad_version).toBe(1);
    expect(upgraded.encrypted_data).not.toEqual(legacyBlob);

    // And the upgraded row is now bound: moving it no longer works.
    storeCredential('conn-other', 'other');
    credentialRows.set('conn-other', { ...credentialRows.get('conn-legacy')! });
    expect(retrieveCredential('conn-other')).toBeNull();
  });

  it('writes new credentials at the current AAD version', () => {
    storeCredential('conn-new', 'fresh');
    expect(credentialRows.get('conn-new')!.aad_version).toBe(1);
  });
});
