import type { StorageEntry } from '@shared/types/storage-provider';
import { describe, expect, it } from 'vitest';
import { folderSyncService } from '../../../src/main/services/folder-sync-service';

/**
 * Folder comparison operates entirely on **second-granularity** timestamps —
 * `shell:readdir` floors `mtimeMs / 1000`, SFTP hands back `attrs.mtime`, and
 * the S3 provider floors `LastModified.getTime() / 1000`. The tolerance used
 * to be `2000`, a millisecond constant applied to those seconds, which meant
 * anything edited in the previous ~33 minutes was reported `identical` and
 * skipped by the sync. These tests pin the unit down so that can't regress.
 */

const T = 1_700_000_000; // arbitrary epoch-seconds anchor

function local(relativePath: string, size: number, mtime: number) {
  return { relativePath, size, mtime };
}

function remote(name: string, size: number, modifiedAt: number): StorageEntry {
  return {
    name,
    path: `/remote/${name}`,
    size,
    modifiedAt,
    isDirectory: false,
    isSymlink: false,
  };
}

describe('FolderSyncService.compareDirectories', () => {
  describe('mtime tolerance is measured in seconds', () => {
    it('treats a 1-second drift as identical (filesystem rounding)', () => {
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 1)],
        [remote('a.txt', 100, T)],
      );
      expect(res.identicalCount).toBe(1);
      expect(res.modifiedCount).toBe(0);
      expect(res.items[0]!.recommendedAction).toBe('skip');
    });

    it('treats an exactly-2-second drift as identical (inclusive bound)', () => {
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 2)],
        [remote('a.txt', 100, T)],
      );
      expect(res.identicalCount).toBe(1);
    });

    it('treats a 3-second drift as modified', () => {
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 3)],
        [remote('a.txt', 100, T)],
      );
      expect(res.modifiedCount).toBe(1);
      expect(res.identicalCount).toBe(0);
      expect(res.items[0]!.status).toBe('modified');
    });

    it('treats a 10-minute-old edit as modified, not identical', () => {
      // The regression this file exists for: 600 s sat well inside the old
      // 2000 "ms" window, so a file edited ten minutes ago at an unchanged
      // byte length was silently never synced.
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 600)],
        [remote('a.txt', 100, T)],
      );
      expect(res.modifiedCount).toBe(1);
      expect(res.items[0]!.recommendedAction).toBe('upload');
    });

    it('is symmetric in bi-directional mode — a remote newer than local is modified', () => {
      // One-way modes only count the source side's changes (see the
      // convergence tests below); bi-directional still sees either.
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T)],
        [remote('a.txt', 100, T + 600)],
        'bi-directional',
      );
      expect(res.modifiedCount).toBe(1);
    });
  });

  it('reports a size mismatch as modified regardless of mtime', () => {
    const res = folderSyncService.compareDirectories(
      [local('a.txt', 100, T)],
      [remote('a.txt', 200, T)],
    );
    expect(res.modifiedCount).toBe(1);
  });

  describe('recommended action follows the sync direction', () => {
    it('sync-to-remote uploads modified files and skips remote-only ones', () => {
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 60)],
        [remote('a.txt', 100, T), remote('b.txt', 50, T)],
        'sync-to-remote',
      );
      const a = res.items.find((i) => i.relativePath === 'a.txt')!;
      const b = res.items.find((i) => i.relativePath === 'b.txt')!;
      expect(a.recommendedAction).toBe('upload');
      expect(b.status).toBe('only-remote');
      expect(b.recommendedAction).toBe('skip');
    });

    it('sync-to-local downloads modified files and skips local-only ones', () => {
      // The remote copy is the newer one: a *newer local* file of the same size
      // is no longer overwritten by an older remote copy.
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T), local('c.txt', 10, T)],
        [remote('a.txt', 100, T + 60)],
        'sync-to-local',
      );
      const a = res.items.find((i) => i.relativePath === 'a.txt')!;
      const c = res.items.find((i) => i.relativePath === 'c.txt')!;
      expect(a.recommendedAction).toBe('download');
      expect(c.status).toBe('only-local');
      expect(c.recommendedAction).toBe('skip');
    });

    it('bi-directional picks the newer side', () => {
      const newerLocal = folderSyncService.compareDirectories(
        [local('a.txt', 100, T + 60)],
        [remote('a.txt', 100, T)],
        'bi-directional',
      );
      expect(newerLocal.items[0]!.recommendedAction).toBe('upload');

      const newerRemote = folderSyncService.compareDirectories(
        [local('a.txt', 100, T)],
        [remote('a.txt', 100, T + 60)],
        'bi-directional',
      );
      expect(newerRemote.items[0]!.recommendedAction).toBe('download');
    });

    it('bi-directional flags a conflict when sizes differ at the same mtime', () => {
      // Reachable only because the tolerance is now small enough for equal
      // timestamps to survive to the conflict branch — with the old 2000 s
      // window a size change inside half an hour never got here.
      const res = folderSyncService.compareDirectories(
        [local('a.txt', 100, T)],
        [remote('a.txt', 200, T)],
        'bi-directional',
      );
      expect(res.items[0]!.recommendedAction).toBe('conflict');
    });
  });

  it('ignores remote directories when building the diff', () => {
    const dir: StorageEntry = {
      name: 'sub',
      path: '/remote/sub',
      size: 0,
      modifiedAt: T,
      isDirectory: true,
      isSymlink: false,
    };
    const res = folderSyncService.compareDirectories([], [dir, remote('a.txt', 1, T)]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.relativePath).toBe('a.txt');
  });

  it('returns zeroed counts for two empty sides', () => {
    const res = folderSyncService.compareDirectories([], []);
    expect(res).toEqual({
      items: [],
      onlyLocalCount: 0,
      onlyRemoteCount: 0,
      modifiedCount: 0,
      identicalCount: 0,
    });
  });
});

describe('FolderSyncService — convergence', () => {
  const service = folderSyncService;
  const remote = (name: string, size: number, modifiedAt: number) => ({
    name,
    path: `/r/${name}`,
    size,
    modifiedAt,
    isDirectory: false,
    isSymlink: false,
  });

  it('does not re-upload a file whose remote copy is simply newer (sync-to-remote)', () => {
    // Regression: after an upload the remote copy is newer than its source
    // (S3 can't set LastModified), and the symmetric mtime test flagged it as
    // modified on every run.
    const res = service.compareDirectories(
      [{ relativePath: 'a.txt', size: 10, mtime: 1000 }],
      [remote('a.txt', 10, 5000)],
      'sync-to-remote',
    );
    expect(res.items[0]).toMatchObject({ status: 'identical', recommendedAction: 'skip' });
  });

  it('still uploads when the local file changed after the remote copy', () => {
    const res = service.compareDirectories(
      [{ relativePath: 'a.txt', size: 10, mtime: 9000 }],
      [remote('a.txt', 10, 5000)],
      'sync-to-remote',
    );
    expect(res.items[0]).toMatchObject({ status: 'modified', recommendedAction: 'upload' });
  });

  it('mirrors the rule for sync-to-local', () => {
    const stale = service.compareDirectories(
      [{ relativePath: 'a.txt', size: 10, mtime: 5000 }],
      [remote('a.txt', 10, 1000)],
      'sync-to-local',
    );
    expect(stale.items[0]?.recommendedAction).toBe('skip');
    const changed = service.compareDirectories(
      [{ relativePath: 'a.txt', size: 10, mtime: 1000 }],
      [remote('a.txt', 10, 5000)],
      'sync-to-local',
    );
    expect(changed.items[0]?.recommendedAction).toBe('download');
  });

  it('always re-sends on a size difference, whatever the timestamps', () => {
    const res = service.compareDirectories(
      [{ relativePath: 'a.txt', size: 11, mtime: 1000 }],
      [remote('a.txt', 10, 5000)],
      'sync-to-remote',
    );
    expect(res.items[0]?.recommendedAction).toBe('upload');
  });
});
