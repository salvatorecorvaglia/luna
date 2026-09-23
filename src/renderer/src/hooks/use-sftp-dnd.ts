import { isCancellation, toastArgs } from '@shared/error-messages';
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { FileEntry } from '@/components/sftp/FilePane';
import { getApi } from '@/services/api';
import { useTransferStore } from '@/stores/transfer-store';

interface UseSftpDndArgs {
  activeSessionId: string | null;
  localPath: string;
  remotePath: string;
}

interface UseSftpDndResult {
  handleLocalDragStart: (entry: FileEntry, e: React.DragEvent) => void;
  handleRemoteDragStart: (entry: FileEntry, e: React.DragEvent) => void;
  handleLocalDrop: (e: React.DragEvent) => Promise<void>;
  handleRemoteDrop: (e: React.DragEvent) => Promise<void>;
}

/**
 * Coordinates drag-and-drop file transfers between the local and remote panes.
 * Lives outside SftpManager so the manager component stays focused on layout
 * and state plumbing rather than data-transfer plumbing.
 *
 * Filename sanitization rejects path-traversal segments and control chars
 * before any IPC: a malicious drag payload (e.g. crafted via devtools) cannot
 * inject `../` or NUL into the remote/local destination filename.
 */
export function useSftpDnd({
  activeSessionId,
  localPath,
  remotePath,
}: UseSftpDndArgs): UseSftpDndResult {
  const addTransfer = useTransferStore((s) => s.addTransfer);

  const sanitizeFilename = useCallback((raw: string): string | null => {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const base = raw.split('/').pop()?.split('\\').pop() ?? '';
    const trimmed = base.trim();
    const hasControlChar = Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0);
      return (code >= 0 && code <= 31) || code === 127;
    });
    if (!trimmed || trimmed === '.' || trimmed === '..' || hasControlChar) {
      return null;
    }
    return trimmed;
  }, []);

  const handleLocalDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const remoteSrc = e.dataTransfer.getData('remote-path');
      const rawFileName = e.dataTransfer.getData('file-name');
      const fileSize = parseInt(e.dataTransfer.getData('file-size') || '0', 10);
      const isDirectory = e.dataTransfer.getData('is-directory') === 'true';
      if (!remoteSrc || !activeSessionId) return;

      // Reject directories before any IPC: directory transfers aren't
      // implemented yet and the previous "warn and continue" path would
      // still enqueue a doomed transfer.
      if (isDirectory) {
        toast.warning(
          'Directory transfers are not yet supported. Please transfer individual files.',
        );
        return;
      }

      const fileName = sanitizeFilename(rawFileName);
      if (!fileName) {
        toast.error('Refused to transfer a file with an unsafe name.');
        return;
      }

      const localDest = await getApi().shell.joinPath(localPath, fileName);
      try {
        const transferId = await getApi().storage.download({
          sessionId: activeSessionId,
          remotePath: remoteSrc,
          localPath: localDest,
        });
        addTransfer({
          id: transferId,
          type: 'download',
          localPath: localDest,
          remotePath: remoteSrc,
          fileName,
          size: fileSize,
          transferred: 0,
          status: 'queued',
          bytesPerSec: 0,
          sessionId: activeSessionId,
        });
      } catch (err: unknown) {
        // A cancel that lands while the transfer is still being set up rejects
        // the enqueue. That's the user's own action (or a disconnect) — not a
        // failure to report as one.
        if (isCancellation(err)) return;
        toast.error(...toastArgs(err, 'Download failed'));
      }
    },
    [activeSessionId, localPath, addTransfer, sanitizeFilename],
  );

  const handleRemoteDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const localSrc = e.dataTransfer.getData('local-path');
      const rawFileName = e.dataTransfer.getData('file-name');
      const fileSize = parseInt(e.dataTransfer.getData('file-size') || '0', 10);
      const isDirectory = e.dataTransfer.getData('is-directory') === 'true';
      if (!localSrc || !activeSessionId) return;

      if (isDirectory) {
        toast.warning(
          'Directory transfers are not yet supported. Please transfer individual files.',
        );
        return;
      }

      const fileName = sanitizeFilename(rawFileName);
      if (!fileName) {
        toast.error('Refused to transfer a file with an unsafe name.');
        return;
      }
      const remoteDest = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`;
      try {
        const transferId = await getApi().storage.upload({
          sessionId: activeSessionId,
          localPath: localSrc,
          remotePath: remoteDest,
        });
        addTransfer({
          id: transferId,
          type: 'upload',
          localPath: localSrc,
          remotePath: remoteDest,
          fileName,
          size: fileSize,
          transferred: 0,
          status: 'queued',
          bytesPerSec: 0,
          sessionId: activeSessionId,
        });
      } catch (err: unknown) {
        if (isCancellation(err)) return;
        toast.error(...toastArgs(err, 'Upload failed'));
      }
    },
    [activeSessionId, remotePath, addTransfer, sanitizeFilename],
  );

  const handleLocalDragStart = useCallback((entry: FileEntry, e: React.DragEvent) => {
    e.dataTransfer.setData('local-path', entry.path);
    e.dataTransfer.setData('file-name', entry.name);
    e.dataTransfer.setData('file-size', String(entry.size || 0));
    e.dataTransfer.setData('is-directory', String(entry.isDirectory));
  }, []);

  const handleRemoteDragStart = useCallback((entry: FileEntry, e: React.DragEvent) => {
    e.dataTransfer.setData('remote-path', entry.path);
    e.dataTransfer.setData('file-name', entry.name);
    e.dataTransfer.setData('file-size', String(entry.size || 0));
    e.dataTransfer.setData('is-directory', String(entry.isDirectory));
  }, []);

  return {
    handleLocalDragStart,
    handleRemoteDragStart,
    handleLocalDrop,
    handleRemoteDrop,
  };
}
