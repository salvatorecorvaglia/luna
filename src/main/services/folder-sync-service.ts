import type { StorageEntry } from '@shared/types/storage-provider';
import type { FolderDiffItem, FolderDiffResult } from '@shared/types/folder-sync';

export type { FolderDiffItem, FolderDiffResult };

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
        const timeDiff = Math.abs((local.mtime || 0) - (remote.modifiedAt || 0));
        const modified = !sizeMatch || timeDiff > 2000;

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
