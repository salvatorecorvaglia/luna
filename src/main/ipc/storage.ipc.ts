import { IPC, LIMITS } from '@shared/constants';
import { storageRegistry } from '../services/storage/registry';
import { transferQueue } from '../services/transfer-queue';
import {
  assertBoundedInt,
  assertNonEmptyString,
  assertSafeRealAbsolutePath,
  assertValidPath,
} from '../lib/validate';
import { takeStorageToken } from '../lib/rate-limiter';
export { __resetStorageRateLimiter } from '../lib/rate-limiter';
import { ErrorCode, LunarError } from '@shared/errors';
import { registerHandler } from '../lib/ipc-handler';
import type {
  StorageDeleteParams,
  StorageListParams,
  StorageMkdirParams,
  StorageReadFileParams,
  StorageRenameParams,
  StorageStatParams,
  StorageTransferParams,
} from '@shared/types/storage-provider';

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
      throw new LunarError('isDirectory must be a boolean', ErrorCode.VALIDATION_ERROR);
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
}
