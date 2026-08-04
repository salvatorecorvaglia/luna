import { IPC, LIMITS } from '@shared/constants';
import { takeStorageToken } from '../lib/rate-limiter';
import {
  assertBoundedInt,
  assertNonEmptyString,
  assertSafeRealAbsolutePath,
  assertValidPath,
} from '../lib/validate';
import { folderSyncService } from '../services/folder-sync-service';
import { storageRegistry } from '../services/storage/registry';
import { transferQueue } from '../services/transfer-queue';

export { __resetStorageRateLimiter } from '../lib/rate-limiter';

/** Per-side ceiling on folder-comparison input. */
const MAX_COMPARE_ENTRIES = 50_000;

const VALID_SYNC_DIRECTIONS = new Set(['sync-to-remote', 'sync-to-local', 'bi-directional']);

import { ErrorCode, LunaError } from '@shared/errors';
import type {
  StorageDeleteParams,
  StorageEntry,
  StorageListParams,
  StorageMkdirParams,
  StorageReadFileParams,
  StorageRenameParams,
  StorageStatParams,
  StorageTransferParams,
} from '@shared/types/storage-provider';
import { registerHandler } from '../lib/ipc-handler';

/**
 * Provider-agnostic IPC handlers. Each call resolves the StorageProvider for
 * the session via the registry, so SFTP and S3 sessions go through the same
 * channels — the renderer doesn't have to branch on provider kind.
 */
export function registerStorageHandlers(): void {
  registerHandler(IPC.STORAGE_LIST, async (_event, params: StorageListParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return storageRegistry.require(params.sessionId).list(params.sessionId, params.path);
  });

  registerHandler(IPC.STORAGE_STAT, async (_event, params: StorageStatParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return storageRegistry.require(params.sessionId).stat(params.sessionId, params.path);
  });

  registerHandler(IPC.STORAGE_MKDIR, async (_event, params: StorageMkdirParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return storageRegistry.require(params.sessionId).mkdir(params.sessionId, params.path);
  });

  registerHandler(IPC.STORAGE_RENAME, async (_event, params: StorageRenameParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.oldPath, 'oldPath');
    assertValidPath(params.newPath, 'newPath');
    takeStorageToken(params.sessionId);
    return storageRegistry
      .require(params.sessionId)
      .rename(params.sessionId, params.oldPath, params.newPath);
  });

  registerHandler(IPC.STORAGE_DELETE, async (_event, params: StorageDeleteParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    if (typeof params.isDirectory !== 'boolean') {
      throw new LunaError('isDirectory must be a boolean', ErrorCode.VALIDATION_ERROR);
    }
    takeStorageToken(params.sessionId);
    return storageRegistry
      .require(params.sessionId)
      .remove(params.sessionId, params.path, params.isDirectory);
  });

  registerHandler(IPC.STORAGE_READ_FILE, async (_event, params: StorageReadFileParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    if (params.maxSize !== undefined) {
      assertBoundedInt(params.maxSize, 'maxSize', 1, LIMITS.MAX_PREVIEW_BYTES);
    }
    takeStorageToken(params.sessionId);
    return storageRegistry
      .require(params.sessionId)
      .readFile(params.sessionId, params.path, params.maxSize);
  });

  registerHandler(
    IPC.STORAGE_WRITE_FILE,
    async (_event, params: { sessionId: string; path: string; content: string }) => {
      assertNonEmptyString(params.sessionId, 'sessionId');
      assertValidPath(params.path, 'path');
      if (typeof params.content !== 'string') {
        throw new LunaError('content must be a string', ErrorCode.VALIDATION_ERROR);
      }
      takeStorageToken(params.sessionId);
      return storageRegistry
        .require(params.sessionId)
        .writeFile(params.sessionId, params.path, params.content);
    },
  );

  registerHandler(IPC.STORAGE_DOWNLOAD, async (_event, params: StorageTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.remotePath, 'remotePath');
    const safeLocal = await assertSafeRealAbsolutePath(params.localPath, 'localPath');
    return transferQueue.enqueue('download', params.sessionId, safeLocal, params.remotePath);
  });

  registerHandler(IPC.STORAGE_UPLOAD, async (_event, params: StorageTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    const safeLocal = await assertSafeRealAbsolutePath(params.localPath, 'localPath');
    assertValidPath(params.remotePath, 'remotePath');
    return transferQueue.enqueue('upload', params.sessionId, safeLocal, params.remotePath);
  });

  registerHandler(
    IPC.STORAGE_COMPARE_DIRECTORIES,
    (
      _event,
      params: {
        sessionId?: string;
        localEntries: { relativePath: string; size: number; mtime: number }[];
        remoteEntries: StorageEntry[];
        direction?: 'sync-to-remote' | 'sync-to-local' | 'bi-directional';
      },
    ) => {
      // This handler was previously unvalidated and unmetered — the only limit
      // was the global 4 MiB IPC payload cap, which still allows tens of
      // thousands of entries per call, repeated as fast as the renderer can
      // issue them. Comparison is O(n) with a Map per side, so that is a
      // straightforward way to pin the main process.
      const localEntries = params.localEntries ?? [];
      const remoteEntries = params.remoteEntries ?? [];
      if (!Array.isArray(localEntries) || !Array.isArray(remoteEntries)) {
        throw new LunaError(
          'localEntries and remoteEntries must be arrays',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      if (localEntries.length > MAX_COMPARE_ENTRIES || remoteEntries.length > MAX_COMPARE_ENTRIES) {
        throw new LunaError(
          `Folder comparison is limited to ${MAX_COMPARE_ENTRIES} entries per side. Sync a narrower subtree.`,
          ErrorCode.VALIDATION_ERROR,
          { limit: MAX_COMPARE_ENTRIES },
        );
      }
      if (params.direction !== undefined && !VALID_SYNC_DIRECTIONS.has(params.direction)) {
        throw new LunaError(
          `direction must be one of ${Array.from(VALID_SYNC_DIRECTIONS).join('|')}`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      // Comparison is per-session work like every other storage op, so it
      // draws from the same bucket when a session id is supplied.
      if (params.sessionId) {
        assertNonEmptyString(params.sessionId, 'sessionId');
        takeStorageToken(params.sessionId);
      }
      return folderSyncService.compareDirectories(localEntries, remoteEntries, params.direction);
    },
  );
}
