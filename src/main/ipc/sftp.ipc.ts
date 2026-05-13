import { IPC, LIMITS } from '@shared/constants';
import { sftpManager } from '../services/sftp-manager';
import { transferQueue } from '../services/transfer-queue';
import {
  assertBoundedInt,
  assertNonEmptyString,
  assertSafeRealAbsolutePath,
  assertValidPath,
} from '../lib/validate';
import { takeStorageToken } from '../lib/rate-limiter';
import { registerHandler } from '../lib/ipc-handler';
import type {
  SftpDeleteParams,
  SftpListParams,
  SftpMkdirParams,
  SftpReadFileParams,
  SftpRenameParams,
  SftpStatParams,
  SftpTransferParams,
} from '@shared/types/sftp';

export function registerSftpHandlers(): void {
  registerHandler(IPC.SFTP_LIST, async (_event, params: SftpListParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return sftpManager.list(params.sessionId, params.path);
  });

  registerHandler(IPC.SFTP_STAT, async (_event, params: SftpStatParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return sftpManager.stat(params.sessionId, params.path);
  });

  registerHandler(IPC.SFTP_MKDIR, async (_event, params: SftpMkdirParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return sftpManager.mkdir(params.sessionId, params.path);
  });

  registerHandler(IPC.SFTP_RENAME, async (_event, params: SftpRenameParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.oldPath, 'oldPath');
    assertValidPath(params.newPath, 'newPath');
    takeStorageToken(params.sessionId);
    return sftpManager.rename(params.sessionId, params.oldPath, params.newPath);
  });

  registerHandler(IPC.SFTP_DELETE, async (_event, params: SftpDeleteParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    takeStorageToken(params.sessionId);
    return sftpManager.remove(params.sessionId, params.path, params.isDirectory);
  });

  registerHandler(IPC.SFTP_READ_FILE, async (_event, params: SftpReadFileParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.path, 'path');
    if (params.maxSize !== undefined) {
      assertBoundedInt(params.maxSize, 'maxSize', 1, LIMITS.MAX_PREVIEW_BYTES);
    }
    takeStorageToken(params.sessionId);
    return sftpManager.readFile(params.sessionId, params.path, params.maxSize);
  });

  registerHandler(IPC.SFTP_DOWNLOAD, async (_event, params: SftpTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertValidPath(params.remotePath, 'remotePath');
    // Follow symlinks in the destination's parent so a planted symlink
    // inside home can't redirect the write outside home.
    const safeLocal = await assertSafeRealAbsolutePath(params.localPath, 'localPath');
    // Enqueue directly so sftp-manager doesn't have to import
    // transfer-queue (and break the import cycle).
    return transferQueue.enqueue('download', params.sessionId, safeLocal, params.remotePath);
  });

  registerHandler(IPC.SFTP_UPLOAD, async (_event, params: SftpTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    // Realpath the source so we read the actual file, not a symlink that
    // points outside the home jail.
    const safeLocal = await assertSafeRealAbsolutePath(params.localPath, 'localPath');
    assertValidPath(params.remotePath, 'remotePath');
    return transferQueue.enqueue('upload', params.sessionId, safeLocal, params.remotePath);
  });

  registerHandler(IPC.TRANSFER_CANCEL, (_event, transferId: string) => {
    assertNonEmptyString(transferId, 'transferId');
    transferQueue.cancel(transferId);
  });

  registerHandler(IPC.TRANSFER_CANCEL_BY_SESSION, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    transferQueue.cancelBySession(sessionId);
  });
}
