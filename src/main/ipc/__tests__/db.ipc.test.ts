import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'os';
import { IPC } from '@shared/constants';
import type { ExportedConnection } from '@shared/types/connection';

// Capture registered handlers so we can invoke them directly.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: { showOpenDialog: vi.fn() },
}));

// Lightweight DB shim: enough surface for registration + importConnections.
// The transaction helper just runs the function synchronously.
type RunFn = (...args: unknown[]) => void;
type GetFn = (...args: unknown[]) => unknown;
const inserts: unknown[][] = [];
const fakeDb = {
  prepare(sql: string): { run: RunFn; get: GetFn; all: () => unknown[] } {
    if (sql.startsWith('INSERT INTO connections')) {
      return { run: ((...args) => inserts.push(args)) as RunFn, get: () => null, all: () => [] };
    }
    if (sql.startsWith('SELECT id FROM connections')) {
      return { run: () => {}, get: () => null, all: () => [] };
    }
    return { run: () => {}, get: () => null, all: () => [] };
  },
  transaction<T extends (...args: unknown[]) => unknown>(fn: T) {
    return (...args: Parameters<T>) => fn(...args);
  },
};

vi.mock('../../services/database', () => ({
  getDatabase: () => fakeDb,
}));

vi.mock('../../services/credential-store', () => ({
  storeCredential: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock('../../services/transfer-queue', () => ({
  transferQueue: { setMaxConcurrent: vi.fn() },
}));

import { registerConnectionHandlers } from '../connection.ipc';
import { registerSettingsHandlers } from '../settings.ipc';

beforeEach(() => {
  handlers.clear();
  inserts.length = 0;
  registerConnectionHandlers();
  registerSettingsHandlers();
});

describe('db.ipc CONNECTION_IMPORT (privateKeyPath sanitization)', () => {
  const HOME = homedir();
  const baseConn: ExportedConnection = {
    name: 'host-1',
    host: 'h1.example.com',
    port: 22,
    username: 'u',
    authType: 'key',
  };

  const importHandler = (): ((conns: ExportedConnection[]) => unknown) => {
    const fn = handlers.get(IPC.CONNECTION_IMPORT)!;
    return (conns) => fn({}, conns);
  };

  it('expands ~ to the home directory and stores the absolute path', async () => {
    const result = (await importHandler()([
      { ...baseConn, privateKeyPath: '~/.ssh/id_ed25519' },
    ])) as {
      imported: number;
      skipped: { reason: string }[];
    };
    expect(result.imported).toBe(1);
    expect(result.skipped).toHaveLength(0);
    // Args to INSERT: id, name, provider, host, port, username, auth_type, private_key_path, ...
    expect(inserts[0][7]).toBe(`${HOME}/.ssh/id_ed25519`);
  });

  it('skips imports whose privateKeyPath escapes via ..', async () => {
    const result = (await importHandler()([
      { ...baseConn, privateKeyPath: '~/../etc/passwd' },
    ])) as {
      imported: number;
      skipped: { reason: string }[];
    };
    expect(result.imported).toBe(0);
    expect(result.skipped[0].reason).toMatch(/home directory/);
  });

  it('skips imports whose privateKeyPath is an absolute system path', async () => {
    const result = (await importHandler()([{ ...baseConn, privateKeyPath: '/etc/shadow' }])) as {
      imported: number;
      skipped: { reason: string }[];
    };
    expect(result.imported).toBe(0);
    expect(result.skipped[0].reason).toMatch(/home directory/);
  });

  it('skips imports whose privateKeyPath contains null bytes', async () => {
    const result = (await importHandler()([{ ...baseConn, privateKeyPath: '~/keys\0/evil' }])) as {
      imported: number;
      skipped: { reason: string }[];
    };
    expect(result.imported).toBe(0);
    expect(result.skipped[0].reason).toMatch(/null bytes/);
  });

  it('accepts a missing privateKeyPath (password auth)', async () => {
    const result = (await importHandler()([{ ...baseConn, authType: 'password' }])) as {
      imported: number;
      skipped: { reason: string }[];
    };
    expect(result.imported).toBe(1);
    expect(inserts[0][7]).toBeNull();
  });

  it('skips records with missing required fields rather than throwing', async () => {
    const result = (await importHandler()([
      { name: '', host: 'h', port: 22, username: 'u', authType: 'password' } as ExportedConnection,
    ])) as { imported: number; skipped: { reason: string }[] };
    expect(result.imported).toBe(0);
    expect(result.skipped[0].reason).toMatch(/name|host|username/);
  });

  it('rejects invalid input shapes early', async () => {
    await expect(importHandler()(undefined as unknown as ExportedConnection[])).rejects.toThrow(
      /array/,
    );
  });
});
