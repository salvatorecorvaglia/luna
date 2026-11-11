import { isCancellation, toastArgs } from '@shared/error-messages';
import { fileExtension, previewMimeForExt } from '@shared/file-types';
import type { FileEntry } from '@shared/types/sftp';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';
import { invalidEntryNameReason } from '@/lib/entry-names';
import { joinRemotePath } from '@/lib/remote-path';
import { enqueueTransfer } from '@/lib/transfers';
import { getApi } from '@/services/api';
import { useStorageStore } from '@/stores/storage-store';

/** File operations and their dialogs; transport/session routing stays with the workspace. */
export function useStorageFileOperations({
  activeSessionId,
  localPath,
  remotePath,
  invalidateSftp,
}: {
  activeSessionId: string | null;
  localPath: string;
  remotePath: string;
  invalidateSftp: (sessionId: string, path?: string) => void;
}) {
  // Context menu download: remote -> local
  const handleRemoteDownload = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId || entry.isDirectory) return;

      try {
        // Inside the try, like the rest: a rejected joinPath was unhandled.
        const localDest = await getApi().shell.joinPath(localPath, entry.name);
        await enqueueTransfer({
          type: 'download',
          sessionId: activeSessionId,
          localPath: localDest,
          remotePath: entry.path,
          fileName: entry.name,
          size: entry.size || 0,
        });
        toast.success(`Download started: ${entry.name}`);
      } catch (err: unknown) {
        // Cancelled during setup (user action / disconnect) — not a failure.
        if (isCancellation(err)) return;
        toast.error(...toastArgs(err, 'Download failed'));
      }
    },
    [activeSessionId, localPath],
  );

  // Context menu upload: local -> remote
  const handleLocalUpload = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId || entry.isDirectory) return;

      const remoteDest = joinRemotePath(remotePath, entry.name);
      try {
        await enqueueTransfer({
          type: 'upload',
          sessionId: activeSessionId,
          localPath: entry.path,
          remotePath: remoteDest,
          fileName: entry.name,
          size: entry.size || 0,
        });
        toast.success(`Upload started: ${entry.name}`);
      } catch (err: unknown) {
        if (isCancellation(err)) return;
        toast.error(...toastArgs(err, 'Upload failed'));
      }
    },
    [activeSessionId, remotePath],
  );

  // Dialog state for rename, delete, mkdir, presigned url, folder sync
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [presignedTarget, setPresignedTarget] = useState<FileEntry | null>(null);
  const [folderSyncOpen, setFolderSyncOpen] = useState(false);

  const setPreviewFile = useStorageStore((s) => s.setPreviewFile);

  // Preview remote file on double-click
  /**
   * Latest preview request. Opening A then B quickly used to show whichever
   * read finished *last* — often A — and the same after switching session or
   * directory mid-read. Only the newest request may open the previewer.
   */
  const previewRequestRef = useRef(0);

  const handleRemoteFileOpen = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId) return;
      const requestId = ++previewRequestRef.current;
      try {
        const ext = fileExtension(entry.name);
        const type = previewMimeForExt(ext);
        if (!type) {
          toast.info(`Cannot preview .${ext} files. Use download to open.`);
          return;
        }

        const { content } = await getApi().storage.readFile({
          sessionId: activeSessionId,
          path: entry.path,
        });
        if (requestId !== previewRequestRef.current) return;
        setPreviewFile({
          name: entry.name,
          content,
          type,
          path: entry.path,
          isLocal: false,
          sessionId: activeSessionId,
        });
      } catch (err: unknown) {
        if (requestId !== previewRequestRef.current) return;
        toast.error(...toastArgs(err, 'Preview failed'));
      }
    },
    [activeSessionId, setPreviewFile],
  );

  // Preview local file on double-click
  const handleLocalFileOpen = useCallback(
    async (entry: FileEntry) => {
      const requestId = ++previewRequestRef.current;
      try {
        const ext = fileExtension(entry.name);
        const type = previewMimeForExt(ext);
        if (!type) {
          toast.info(`Cannot preview .${ext} files. Use your system file manager to open.`);
          return;
        }

        const { content } = await getApi().shell.readFile(entry.path);
        if (requestId !== previewRequestRef.current) return;
        setPreviewFile({
          name: entry.name,
          content,
          type,
          path: entry.path,
          isLocal: true,
        });
      } catch (err: unknown) {
        if (requestId !== previewRequestRef.current) return;
        toast.error(...toastArgs(err, 'Preview failed'));
      }
    },
    [setPreviewFile],
  );

  // Rename remote file/directory
  const handleRemoteRename = useCallback((entry: FileEntry) => {
    setRenameTarget(entry);
  }, []);

  const handleRenameConfirm = useCallback(
    async (rawName: string) => {
      if (!activeSessionId || !renameTarget) return;
      setRenameTarget(null);
      const invalid = invalidEntryNameReason(rawName);
      if (invalid) {
        toast.error(invalid);
        return;
      }
      const newName = rawName.trim();
      if (newName === renameTarget.name) return;

      const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/')) || '/';
      const newPath = joinRemotePath(parentPath, newName);
      try {
        await getApi().storage.rename({
          sessionId: activeSessionId,
          oldPath: renameTarget.path,
          newPath,
        });
        toast.success(`Renamed to ${newName}`);
        invalidateSftp(activeSessionId, remotePath);
      } catch (err: unknown) {
        toast.error(...toastArgs(err, 'Rename failed'));
      }
    },
    [activeSessionId, remotePath, invalidateSftp, renameTarget],
  );

  // Delete remote file/directory
  const handleRemoteDelete = useCallback((entry: FileEntry) => {
    setDeleteTarget(entry);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!activeSessionId || !deleteTarget) return;
    const entry = deleteTarget;
    setDeleteTarget(null);

    try {
      await getApi().storage.delete({
        sessionId: activeSessionId,
        path: entry.path,
        isDirectory: entry.isDirectory,
      });
      toast.success(`Deleted ${entry.name}`);
      invalidateSftp(activeSessionId, remotePath);
    } catch (err: unknown) {
      toast.error(...toastArgs(err, 'Delete failed'));
    }
  }, [activeSessionId, remotePath, invalidateSftp, deleteTarget]);

  // Copy path to clipboard — same behaviour on both sides.
  const handleCopyPath = useCallback((entry: FileEntry) => {
    void copyToClipboard(entry.path, 'Path copied to clipboard');
  }, []);

  // Create directory on remote
  const handleRemoteMkdir = useCallback(() => {
    setMkdirOpen(true);
  }, []);

  const handleMkdirConfirm = useCallback(
    async (rawName: string) => {
      if (!activeSessionId) return;
      setMkdirOpen(false);
      const invalid = invalidEntryNameReason(rawName);
      if (invalid) {
        toast.error(invalid);
        return;
      }
      const name = rawName.trim();

      const newPath = joinRemotePath(remotePath, name);
      try {
        await getApi().storage.mkdir({ sessionId: activeSessionId, path: newPath });
        toast.success(`Created folder "${name}"`);
        invalidateSftp(activeSessionId, remotePath);
      } catch (err: unknown) {
        toast.error(...toastArgs(err, 'Failed to create folder'));
      }
    },
    [activeSessionId, remotePath, invalidateSftp],
  );

  useEffect(
    () => () => {
      previewRequestRef.current++;
    },
    [activeSessionId, localPath, remotePath],
  );
  return {
    handleRemoteDownload,
    handleLocalUpload,
    handleRemoteFileOpen,
    handleLocalFileOpen,
    handleRemoteRename,
    handleRenameConfirm,
    handleRemoteDelete,
    handleDeleteConfirm,
    handleCopyPath,
    handleRemoteMkdir,
    handleMkdirConfirm,
    renameTarget,
    setRenameTarget,
    deleteTarget,
    setDeleteTarget,
    mkdirOpen,
    setMkdirOpen,
    presignedTarget,
    setPresignedTarget,
    folderSyncOpen,
    setFolderSyncOpen,
  };
}
