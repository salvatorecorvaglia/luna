import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'lunar-cred-inmemory-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('keyring unavailable');
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

import {
  getCredentialBackendStatus,
  initializeCredentialStore,
  retrieveCredential,
  storeCredential,
} from '../credential-store';

describe('credential-store in-memory fallback', () => {
  it('falls back to "inMemory" when safeStorage is unavailable and no key file exists', () => {
    expect(getCredentialBackendStatus().backend).toBe('uninitialized');
    initializeCredentialStore();
    expect(getCredentialBackendStatus().backend).toBe('inMemory');
  });

  it('throws a forbidden error when trying to save credentials', () => {
    expect(() => storeCredential('conn-1', 'password')).toThrow(
      /Cannot save connection credentials/,
    );
  });

  it('returns null when trying to retrieve credentials', () => {
    expect(retrieveCredential('conn-1')).toBeNull();
  });
});

afterAll(() => {
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
