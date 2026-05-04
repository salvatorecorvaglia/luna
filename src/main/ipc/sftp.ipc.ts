import { ipcMain } from 'electron'
import { IPC } from '@shared/constants'
import { sftpManager } from '../services/sftp-manager'
import { transferQueue } from '../services/transfer-queue'
import {
  assertNonEmptyString,
  assertValidPath,
  assertBoundedInt,
  assertSafeAbsolutePath
} from '../lib/validate'
import { LIMITS } from '@shared/constants'
import type {
  SftpListParams,
  SftpStatParams,
  SftpMkdirParams,
  SftpRenameParams,
  SftpDeleteParams,
  SftpReadFileParams,
  SftpTransferParams
} from '@shared/types/sftp'

export function registerSftpHandlers(): void {
  ipcMain.handle(IPC.SFTP_LIST, async (_event, params: SftpListParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.path, 'path')
    return sftpManager.list(params.sessionId, params.path)
  })

  ipcMain.handle(IPC.SFTP_STAT, async (_event, params: SftpStatParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.path, 'path')
    return sftpManager.stat(params.sessionId, params.path)
  })

  ipcMain.handle(IPC.SFTP_MKDIR, async (_event, params: SftpMkdirParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.path, 'path')
    return sftpManager.mkdir(params.sessionId, params.path)
  })

  ipcMain.handle(IPC.SFTP_RENAME, async (_event, params: SftpRenameParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.oldPath, 'oldPath')
    assertValidPath(params.newPath, 'newPath')
    return sftpManager.rename(params.sessionId, params.oldPath, params.newPath)
  })

  ipcMain.handle(IPC.SFTP_DELETE, async (_event, params: SftpDeleteParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.path, 'path')
    return sftpManager.remove(params.sessionId, params.path, params.isDirectory)
  })

  ipcMain.handle(IPC.SFTP_READ_FILE, async (_event, params: SftpReadFileParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.path, 'path')
    if (params.maxSize !== undefined) {
      assertBoundedInt(params.maxSize, 'maxSize', 1, LIMITS.MAX_PREVIEW_BYTES)
    }
    return sftpManager.readFile(params.sessionId, params.path, params.maxSize)
  })

  ipcMain.handle(IPC.SFTP_DOWNLOAD, async (_event, params: SftpTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertValidPath(params.remotePath, 'remotePath')
    assertSafeAbsolutePath(params.localPath, 'localPath')
    return sftpManager.download(params.sessionId, params.remotePath, params.localPath)
  })

  ipcMain.handle(IPC.SFTP_UPLOAD, async (_event, params: SftpTransferParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId')
    assertSafeAbsolutePath(params.localPath, 'localPath')
    assertValidPath(params.remotePath, 'remotePath')
    return sftpManager.upload(params.sessionId, params.localPath, params.remotePath)
  })

  ipcMain.handle(IPC.TRANSFER_CANCEL, (_event, transferId: string) => {
    assertNonEmptyString(transferId, 'transferId')
    transferQueue.cancel(transferId)
  })
}
