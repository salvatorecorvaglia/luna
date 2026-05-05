import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

// Set up a per-test userData dir so safeStorage / on-disk key writes don't
// collide between runs. Mock electron *before* importing the module under test.
const userData = mkdtempSync(join(tmpdir(), 'lunar-cred-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock('../database', () => ({
  getDatabase: () => ({ exec: () => {}, prepare: () => ({ run: () => {} }) }),
}));

vi.mock('../../lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { __test__ } from '../credential-store';

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
});

// Cleanup tmp dir at end of run.
afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
