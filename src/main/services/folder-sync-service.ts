import type { FolderDiffItem, FolderDiffResult } from '@shared/types/folder-sync';
import type { StorageEntry } from '@shared/types/storage-provider';

export type { FolderDiffItem, FolderDiffResult };

/**
 * How far two timestamps may drift before a file counts as modified.
 *
 * **Seconds, not milliseconds.** Every producer feeding this comparison stores
 * whole seconds: local entries come from `shell:readdir`
 * (`Math.floor(mtimeMs / 1000)`), SFTP entries from `attrs.mtime`, and S3
 * entries from `Math.floor(LastModified.getTime() / 1000)`. The value here was
 * `2000` — a millisecond constant applied to second-granularity input, so the
 * real tolerance was 2000 seconds (~33 minutes). Any file edited within the
 * last half hour whose size happened to match was reported `identical` and
 * silently skipped by the sync, and `bi-directional` never reached its
 * conflict branch for those files at all.
 *
 * 2 s absorbs filesystem/protocol rounding (FAT stores mtime at 2 s
 * granularity) without hiding a real edit.
 */
const MTIME_TOLERANCE_SEC = 2;

export class FolderSyncService {
  /**
   * Compares local file entries with remote storage entries relative to their root folders.
   */
  compareDirectories(
    localEntries: { relativePath: string; size: number; mtime: number }[],
    remoteEntries: StorageEntry[],
    direction: 'sync-to-remote' | 'sync-to-local' | 'bi-directional' = 'sync-to-remote',
  ): FolderDiffResult {
    const localMap = new Map<string, { size: number; mtime: number }>();
    for (const item of localEntries) {
      localMap.set(item.relativePath, { size: item.size, mtime: item.mtime });
    }

    const remoteMap = new Map<string, StorageEntry>();
    for (const item of remoteEntries) {
      if (!item.isDirectory) {
        remoteMap.set(item.name, item);
      }
    }

    const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const items: FolderDiffItem[] = [];

    let onlyLocalCount = 0;
    let onlyRemoteCount = 0;
    let modifiedCount = 0;
    let identicalCount = 0;

    for (const path of allKeys) {
      const local = localMap.get(path);
      const remote = remoteMap.get(path);

      if (local && !remote) {
        onlyLocalCount++;
        items.push({
          relativePath: path,
          localSize: local.size,
          localMtime: local.mtime,
          status: 'only-local',
          recommendedAction: direction === 'sync-to-local' ? 'skip' : 'upload',
        });
      } else if (!local && remote) {
        onlyRemoteCount++;
        items.push({
          relativePath: path,
          remoteSize: remote.size,
          remoteMtime: remote.modifiedAt,
          status: 'only-remote',
          recommendedAction: direction === 'sync-to-remote' ? 'skip' : 'download',
        });
      } else if (local && remote) {
        const sizeMatch = local.size === remote.size;
        const timeDiffSec = Math.abs((local.mtime || 0) - (remote.modifiedAt || 0));
        const modified = !sizeMatch || timeDiffSec > MTIME_TOLERANCE_SEC;

        if (modified) {
          modifiedCount++;
          let action: 'upload' | 'download' | 'conflict' = 'upload';
          if (direction === 'sync-to-local') {
            action = 'download';
          } else if (direction === 'bi-directional') {
            if ((local.mtime || 0) > (remote.modifiedAt || 0)) {
              action = 'upload';
            } else if ((remote.modifiedAt || 0) > (local.mtime || 0)) {
              action = 'download';
            } else {
              action = 'conflict';
            }
          }

          items.push({
            relativePath: path,
            localSize: local.size,
            localMtime: local.mtime,
            remoteSize: remote.size,
            remoteMtime: remote.modifiedAt,
            status: 'modified',
            recommendedAction: action,
          });
        } else {
          identicalCount++;
          items.push({
            relativePath: path,
            localSize: local.size,
            localMtime: local.mtime,
            remoteSize: remote.size,
            remoteMtime: remote.modifiedAt,
            status: 'identical',
            recommendedAction: 'skip',
          });
        }
      }
    }

    return {
      items,
      onlyLocalCount,
      onlyRemoteCount,
      modifiedCount,
      identicalCount,
    };
  }
}

export const folderSyncService = new FolderSyncService();
