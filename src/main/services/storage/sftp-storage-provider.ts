import type { StorageEntry, StorageStatResult } from '@shared/types/storage-provider';
import { sftpManager } from '../sftp-manager';
import type { StepCallback, StorageProvider } from './types';

/**
 * Thin adapter that exposes the existing `sftpManager` singleton through the
 * provider-agnostic interface. Keeps SFTP code paths unchanged while letting
 * the registry, transfer queue, and `storage:*` IPC handlers be uniform.
 */
class SftpStorageProvider implements StorageProvider {
  readonly kind = 'sftp' as const;

  async list(sessionId: string, path: string): Promise<StorageEntry[]> {
    const entries = await sftpManager.list(sessionId, path);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      size: e.size,
      modifiedAt: e.modifiedAt,
      isDirectory: e.isDirectory,
      isSymlink: e.isSymlink,
      permissions: e.permissions,
      owner: e.owner,
      group: e.group,
    }));
  }

  async stat(sessionId: string, path: string): Promise<StorageStatResult> {
    const s = await sftpManager.stat(sessionId, path);
    return {
      size: s.size,
      modifiedAt: s.modifiedAt,
      isDirectory: s.isDirectory,
      isSymlink: s.isSymlink,
      permissions: s.permissions,
    };
  }

  mkdir(sessionId: string, path: string): Promise<void> {
    return sftpManager.mkdir(sessionId, path);
  }

  rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return sftpManager.rename(sessionId, oldPath, newPath);
  }

  remove(sessionId: string, path: string, isDirectory: boolean): Promise<void> {
    return sftpManager.remove(sessionId, path, isDirectory);
  }

  readFile(
    sessionId: string,
    path: string,
    maxSize?: number,
  ): Promise<{ content: string; encoding: 'utf-8' | 'base64' }> {
    return sftpManager.readFile(sessionId, path, maxSize);
  }

  writeFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<void> {
    return sftpManager.writeFile(sessionId, path, content);
  }

  statSize(sessionId: string, path: string): Promise<number> {
    return sftpManager.statSize(sessionId, path);
  }

  streamDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    return sftpManager.streamDownload(sessionId, remotePath, localPath, onStep, signal);
  }

  streamUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    return sftpManager.streamUpload(sessionId, localPath, remotePath, onStep, signal);
  }

  closeSession(sessionId: string): void {
    sftpManager.closeSftp(sessionId);
  }
}

export const sftpStorageProvider = new SftpStorageProvider();
