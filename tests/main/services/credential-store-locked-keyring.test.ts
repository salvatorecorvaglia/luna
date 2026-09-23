import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Regression: a transient keyring failure used to destroy every stored credential.
 *
 * `safeStorage.decryptString` fails non-destructively in entirely ordinary
 * situations — a locked macOS Keychain, the user clicking "Deny" on the ACL
 * prompt, Windows DPAPI after a profile move, a Linux keyring not yet unlocked
 * at login. The old code caught that, nulled the key, fell through to the
 * "no key file" branch and OVERWROTE `.storage_key.enc` with a fresh random
 * key. Every saved SSH password, passphrase and S3 access key became
 * permanently undecryptable, and `retrieveCredential` then deleted the rows.
 *
 * A key we cannot read is recoverable (unlock and restart). A key we have
 * overwritten is not. So: fail loudly, leave the file byte-for-byte alone.
 */
const userData = mkdtempSync(join(tmpdir(), 'luna-cred-locked-'));
const wrappedPath = join(userData, '.storage_key.enc');
const ORIGINAL_WRAPPED = Buffer.from('a real wrapped key that we must not clobber');
writeFileSync(wrappedPath, ORIGINAL_WRAPPED);

// No plaintext `.storage_key`: it is unlinked once migration succeeds, so this
// is the state of every modern install — and it is exactly what steered the old
// code into the regeneration branch.
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: () => {
      throw new Error('The user name or passphrase you entered is not correct.');
    },
    encryptString: (s: string) => Buffer.from(`wrapped:${s}`),
  },
}));

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => ({
    exec: () => {},
    prepare: () => ({
      run: () => {},
      // A stored row exists, so retrieveCredential gets past its early return
      // and reaches the key resolution that must throw rather than "tamper".
      get: () => ({ encrypted_data: Buffer.alloc(64) }),
    }),
  }),
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  getCredentialBackendStatus,
  initializeCredentialStore,
  onCredentialTamper,
  retrieveCredential,
  storeCredential,
} from '../../../src/main/services/credential-store';

describe('credential-store with an unreadable key file', () => {
  it('leaves the wrapped key file byte-for-byte intact', () => {
    initializeCredentialStore();
    expect(readFileSync(wrappedPath)).toEqual(ORIGINAL_WRAPPED);
  });

  it('reports "locked" rather than pretending the store is uninitialized', () => {
    // 'uninitialized' reads as "nothing here yet"; the renderer would say the
    // wrong thing. The credentials exist and are fine — they are just locked.
    expect(getCredentialBackendStatus().backend).toBe('locked');
  });

  it('refuses to store rather than encrypting under a newly invented key', () => {
    expect(() => storeCredential('conn-1', 'secret')).toThrow(/could not unlock/i);
    expect(readFileSync(wrappedPath)).toEqual(ORIGINAL_WRAPPED);
  });

  it('surfaces the key error on retrieve instead of reporting tampering', () => {
    // The critical distinction: a locked keyring must NOT look like a GCM tag
    // mismatch. If it did, every credential would be flagged as tampered the
    // moment the keyring happened to be locked.
    const events: unknown[] = [];
    const unsubscribe = onCredentialTamper((e) => events.push(e));
    try {
      expect(() => retrieveCredential('conn-1')).toThrow(/could not unlock/i);
      expect(events).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });

  it('keeps failing the same way instead of regenerating on a later call', () => {
    // The retry path is its own hazard: re-running the load would reach the
    // regeneration branch that the first call avoided.
    expect(() => storeCredential('conn-2', 'secret')).toThrow(/could not unlock/i);
    expect(getCredentialBackendStatus().backend).toBe('locked');
    expect(readFileSync(wrappedPath)).toEqual(ORIGINAL_WRAPPED);
  });
});

afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
