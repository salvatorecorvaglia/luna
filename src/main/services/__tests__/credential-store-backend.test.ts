import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Seed a plaintext key file *before* importing the module under test so the
// migration branch (existing plaintext key + safeStorage available) is what
// the module observes on first init. The safeStorage mock then throws on
// encryptString to simulate a wrap failure — the credential store must keep
// using the plaintext key (so existing creds remain readable) AND flip the
// backend flag so the renderer banner can surface the downgrade.
const userData = mkdtempSync(join(tmpdir(), 'luna-cred-backend-'));
writeFileSync(join(userData, '.storage_key'), randomBytes(32));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: () => {
      throw new Error('keyring write denied');
    },
    decryptString: () => '',
  },
}));

vi.mock('../database', () => ({
  getDatabase: () => ({
    exec: () => {},
    prepare: () => ({ run: () => {}, get: () => undefined }),
  }),
}));

vi.mock('../../lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getCredentialBackendStatus, initializeCredentialStore } from '../credential-store';

describe('credential-store backend status', () => {
  it('flips to "plaintext" when migrating a plaintext key into safeStorage fails', () => {
    expect(getCredentialBackendStatus().backend).toBe('uninitialized');
    initializeCredentialStore();
    // safeStorage was advertised as available but encryptString threw — the
    // store keeps the plaintext key in memory (so the user's existing creds
    // remain accessible) and tags the backend so the renderer can surface a
    // security banner.
    expect(getCredentialBackendStatus().backend).toBe('plaintext');
  });
});

afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
