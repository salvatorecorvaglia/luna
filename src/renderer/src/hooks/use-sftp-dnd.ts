import { toastArgs } from '@shared/error-messages';
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { FileEntry } from '@/components/sftp/FilePane';
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
    // Strip any path components from either separator style.
    const base = raw.split('/').pop()?.split('\\').pop() ?? '';
    const trimmed = base.trim();
    // Reject NUL / control chars (U+0000–U+001F, U+007F): no legitimate
    // filename uses them and many file systems mishandle them.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: suppressed during migration
    const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
    if (!trimmed || trimmed === '.' || trimmed === '..' || CONTROL_CHARS.test(trimmed)) {
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

      const localDest = await window.api.shell.joinPath(localPath, fileName);
      try {
        const transferId = await window.api.storage.download({
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
        const transferId = await window.api.storage.upload({
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
