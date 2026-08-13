import { describe, expect, it, vi } from 'vitest';
import { storageRegistry } from '../../../../src/main/services/storage/registry';
import type { StorageProvider } from '../../../../src/main/services/storage/types';

const makeProvider = (kind: StorageProvider['kind'] = 'sftp'): StorageProvider =>
  ({
    kind,
    list: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    statSize: vi.fn(),
    streamDownload: vi.fn(),
    streamUpload: vi.fn(),
    closeSession: vi.fn(),
  }) as StorageProvider;

describe('storageRegistry', () => {
  it('register/get round-trip', () => {
    const p = makeProvider();
    storageRegistry.register('s1', p);
    expect(storageRegistry.get('s1')).toBe(p);
    expect(storageRegistry.kindOf('s1')).toBe('sftp');
    storageRegistry.unregister('s1');
    expect(storageRegistry.get('s1')).toBeUndefined();
  });

  it('require() throws when no provider is registered', () => {
    expect(() => storageRegistry.require('missing')).toThrow(/No storage provider/);
  });

  it('distinguishes provider kinds across sessions', () => {
    storageRegistry.register('a', makeProvider('sftp'));
    storageRegistry.register('b', makeProvider('s3'));
    expect(storageRegistry.kindOf('a')).toBe('sftp');
    expect(storageRegistry.kindOf('b')).toBe('s3');
    storageRegistry.unregister('a');
    storageRegistry.unregister('b');
  });

  it('kindOf returns undefined for missing sessions', () => {
    expect(storageRegistry.kindOf('ghost')).toBeUndefined();
  });
});
