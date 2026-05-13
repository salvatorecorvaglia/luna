import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Plus, Unplug, WifiOff } from 'lucide-react';
import { useStorageStore } from '@/stores/storage-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useTransferStore } from '@/stores/transfer-store';
import { useConnectionStore } from '@/stores/connection-store';
import {
  useInvalidateLocalDir,
  useInvalidateSftp,
  useLocalDirectory,
  useSftpDirectory,
} from '@/hooks/use-sftp';
import { useSftpDnd } from '@/hooks/use-sftp-dnd';
import { resolveSftpSession } from './sftp-session-fallback';
import { type FileEntry, FilePane } from './FilePane';
import { TransferQueue } from './TransferQueue';
import { FilePreview } from './FilePreview';
import { PromptDialog } from '@/components/common/PromptDialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

// Pulled to module scope so they're allocated once at module load instead of
// rebuilt on every preview-open render. Both lists are immutable and shared
// between the remote and local file-preview handlers.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'] as const;
const TEXT_EXTS = [
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'sh',
  'bash',
  'zsh',
  'py',
  'js',
  'ts',
  'tsx',
  'jsx',
  'html',
  'css',
  'scss',
  'conf',
  'cfg',
  'ini',
  'toml',
  'env',
  'gitignore',
  'editorconfig',
  'Makefile',
  'Dockerfile',
  'rs',
  'go',
  'rb',
  'php',
  'java',
  'c',
  'h',
  'cpp',
] as const;

function mimeForExt(ext: string, isPdf: boolean): string {
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) {
    return `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`;
  }
  if (isPdf) return 'application/pdf';
  return 'text/plain';
}

export function SftpManager() {
  // Collapse 13 separate selectors into a single shallow-equality
  // subscription. Each `useStorageStore(s => s.X)` call previously installed
  // its own subscription and ran a separate Object.is check on every store
  // change. With useShallow, we have one subscription and one shallow
  // comparison over the slice we actually consume.
  const {
    localPath,
    remotePath,
    localSelection,
    remoteSelection,
    activeSessionId,
    storageSessions,
    setLocalPath,
    setRemotePath,
    toggleLocalSelection,
    toggleRemoteSelection,
    setActiveSessionId,
    setLocalSelection,
    setRemoteSelection,
    showHiddenFiles,
    toggleHiddenFiles,
  } = useStorageStore(
    useShallow((s) => ({
      localPath: s.localPath,
      remotePath: s.remotePath,
      localSelection: s.localSelection,
      remoteSelection: s.remoteSelection,
      activeSessionId: s.activeSessionId,
      storageSessions: s.storageSessions,
      setLocalPath: s.setLocalPath,
      setRemotePath: s.setRemotePath,
      toggleLocalSelection: s.toggleLocalSelection,
      toggleRemoteSelection: s.toggleRemoteSelection,
      setActiveSessionId: s.setActiveSessionId,
      setLocalSelection: s.setLocalSelection,
      setRemoteSelection: s.setRemoteSelection,
      showHiddenFiles: s.showHiddenFiles,
      toggleHiddenFiles: s.toggleHiddenFiles,
    })),
  );

  const sessions = useTerminalStore((s) => s.sessions);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const invalidateSftp = useInvalidateSftp();
  const invalidateLocal = useInvalidateLocalDir();
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync activeSessionId with the active connection if it changes. Resolution
  // logic lives in sftp-session-fallback.ts so it can be unit-tested in
  // isolation from this component's other state.
  useEffect(() => {
    const targetSessionId = resolveSftpSession(
      sessions,
      storageSessions,
      activeConnectionId,
      activeSessionId,
    );
    if (targetSessionId && targetSessionId !== activeSessionId) {
      setActiveSessionId(targetSessionId);
      // Reset path when switching sessions to avoid "No such file" errors
      // if the previous session's path doesn't exist on the new one.
      const storageSess = storageSessions.get(targetSessionId);
      setRemotePath(storageSess?.initialPath || '/');
    }
  }, [
    activeConnectionId,
    sessions,
    storageSessions,
    activeSessionId,
    setActiveSessionId,
    setRemotePath,
  ]);

  // Set local path to home directory on mount
  useEffect(() => {
    if (!localPath) {
      window.api.shell
        .homeDir()
        .then(setLocalPath)
        .catch(() => {
          setLocalPath('/');
        });
    }
  }, [localPath, setLocalPath]);

  const isSessionActive =
    !!activeSessionId && (sessions.has(activeSessionId) || storageSessions.has(activeSessionId));

  // Provider kind for the currently-displayed remote pane. SSH terminal
  // sessions always back SFTP; an entry in storageSessions carries its own
  // kind (s3 today, more later).
  const remoteKind: 'sftp' | 's3' = activeSessionId
    ? (storageSessions.get(activeSessionId)?.provider ?? 'sftp')
    : 'sftp';

  const {
    data: remoteEntries = [],
    isLoading: remoteLoading,
    error: remoteError,
  } = useSftpDirectory(activeSessionId, remotePath, { enabled: isSessionActive });

  const {
    data: localEntries = [],
    isLoading: localLoading,
    error: localError,
  } = useLocalDirectory(localPath);

  useEffect(() => {
    if (remoteError) {
      toast.error(
        `Remote listing failed: ${remoteError instanceof Error ? remoteError.message : String(remoteError)}`,
      );
    }
  }, [remoteError]);

  useEffect(() => {
    if (localError) {
      toast.error(
        `Local listing failed: ${localError instanceof Error ? localError.message : String(localError)}`,
      );
    }
  }, [localError]);

  const addTransfer = useTransferStore((s) => s.addTransfer);

  // Drag-and-drop transfer handlers live in their own hook so this component
  // can stay focused on layout, sessions, and dialog state.
  const { handleLocalDragStart, handleRemoteDragStart, handleLocalDrop, handleRemoteDrop } =
    useSftpDnd({ activeSessionId, localPath, remotePath });

  // Context menu download: remote -> local
  const handleRemoteDownload = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId || entry.isDirectory) return;

      const localDest = await window.api.shell.joinPath(localPath, entry.name);
      try {
        const transferId = await window.api.storage.download({
          sessionId: activeSessionId,
          remotePath: entry.path,
          localPath: localDest,
        });
        addTransfer({
          id: transferId,
          type: 'download',
          localPath: localDest,
          remotePath: entry.path,
          fileName: entry.name,
          size: entry.size || 0,
          transferred: 0,
          status: 'queued',
          bytesPerSec: 0,
          sessionId: activeSessionId,
        });
        toast.success(`Download started: ${entry.name}`);
      } catch (err: unknown) {
        toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeSessionId, localPath, addTransfer],
  );

  // Context menu upload: local -> remote
  const handleLocalUpload = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId || entry.isDirectory) return;

      const remoteDest = remotePath === '/' ? `/${entry.name}` : `${remotePath}/${entry.name}`;
      try {
        const transferId = await window.api.storage.upload({
          sessionId: activeSessionId,
          localPath: entry.path,
          remotePath: remoteDest,
        });
        addTransfer({
          id: transferId,
          type: 'upload',
          localPath: entry.path,
          remotePath: remoteDest,
          fileName: entry.name,
          size: entry.size || 0,
          transferred: 0,
          status: 'queued',
          bytesPerSec: 0,
          sessionId: activeSessionId,
        });
        toast.success(`Upload started: ${entry.name}`);
      } catch (err: unknown) {
        toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeSessionId, remotePath, addTransfer],
  );

  // Dialog state for rename, delete, mkdir
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);

  const setPreviewFile = useStorageStore((s) => s.setPreviewFile);

  // Preview remote file on double-click
  const handleRemoteFileOpen = useCallback(
    async (entry: FileEntry) => {
      if (!activeSessionId) return;
      try {
        const { content } = await window.api.storage.readFile({
          sessionId: activeSessionId,
          path: entry.path,
        });
        const ext = entry.name.split('.').pop()?.toLowerCase() || '';
        const type = mimeForExt(ext, ext === 'pdf');
        setPreviewFile({ name: entry.name, content, type });
      } catch (err: unknown) {
        toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeSessionId, setPreviewFile],
  );

  // Preview local file on double-click
  const handleLocalFileOpen = useCallback(
    async (entry: FileEntry) => {
      try {
        const ext = entry.name.split('.').pop()?.toLowerCase() || '';
        const isPdf = ext === 'pdf';

        if (
          !(TEXT_EXTS as readonly string[]).includes(ext) &&
          !(IMAGE_EXTS as readonly string[]).includes(ext) &&
          !isPdf
        ) {
          toast.info(`Cannot preview .${ext} files. Use your system file manager to open.`);
          return;
        }

        const { content } = (await window.api.shell.readFile(entry.path)) as {
          content: string;
        };
        const type = mimeForExt(ext, isPdf);

        setPreviewFile({ name: entry.name, content, type });
      } catch (err: unknown) {
        toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [setPreviewFile],
  );

  // Rename remote file/directory
  const handleRemoteRename = useCallback((entry: FileEntry) => {
    setRenameTarget(entry);
  }, []);

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!activeSessionId || !renameTarget) return;
      setRenameTarget(null);
      if (newName === renameTarget.name) return;

      const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/')) || '/';
      const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
      try {
        await window.api.storage.rename({
          sessionId: activeSessionId,
          oldPath: renameTarget.path,
          newPath,
        });
        toast.success(`Renamed to ${newName}`);
        invalidateSftp(activeSessionId, remotePath);
      } catch (err: unknown) {
        toast.error(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
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
      await window.api.storage.delete({
        sessionId: activeSessionId,
        path: entry.path,
        isDirectory: entry.isDirectory,
      });
      toast.success(`Deleted ${entry.name}`);
      invalidateSftp(activeSessionId, remotePath);
    } catch (err: unknown) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeSessionId, remotePath, invalidateSftp, deleteTarget]);

  // Copy remote path to clipboard
  const handleRemoteCopyPath = useCallback((entry: FileEntry) => {
    void navigator.clipboard.writeText(entry.path);
    toast.success('Path copied to clipboard');
  }, []);

  // Create directory on remote
  const handleRemoteMkdir = useCallback(() => {
    setMkdirOpen(true);
  }, []);

  const handleMkdirConfirm = useCallback(
    async (name: string) => {
      if (!activeSessionId) return;
      setMkdirOpen(false);

      const newPath = remotePath === '/' ? `/${name}` : `${remotePath}/${name}`;
      try {
        await window.api.storage.mkdir({ sessionId: activeSessionId, path: newPath });
        toast.success(`Created folder "${name}"`);
        invalidateSftp(activeSessionId, remotePath);
      } catch (err: unknown) {
        toast.error(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeSessionId, remotePath, invalidateSftp],
  );

  // Resize handle
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    let rafId: number | null = null;
    let pending: number | null = null;
    const flush = (): void => {
      rafId = null;
      if (pending !== null) {
        setSplitRatio(pending);
        pending = null;
      }
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      pending = Math.max(0.2, Math.min(0.8, ratio));
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    const onMouseUp = (): void => {
      setResizing(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        flush();
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  if (
    !activeSessionId ||
    (!sessions.get(activeSessionId) && !storageSessions.get(activeSessionId))
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
          <Unplug className="h-7 w-7 text-muted-foreground/30" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/60">No active connection</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Connect to a server first, then switch to SFTP view
          </p>
        </div>
        <button
          onClick={() => useConnectionStore.getState().openCreateForm()}
          className="btn-outline mt-1"
        >
          <Plus className="h-3.5 w-3.5" />
          New Connection
        </button>
      </div>
    );
  }

  // Show warning overlay when session disconnects mid-use. S3 sessions don't
  // disconnect mid-use the way SSH does, so we only check the SSH side.
  // The overlay auto-dismisses when status flips back to 'connected' because
  // the derived flag flips with it — no imperative dismiss needed.
  const activeSession = sessions.get(activeSessionId);
  const isDisconnected = activeSession && activeSession.status !== 'connected';
  const overlayMessage =
    activeSession?.status === 'reconnecting'
      ? 'Reconnecting…'
      : activeSession?.status === 'connecting'
        ? 'Connecting…'
        : activeSession?.status === 'error'
          ? 'Reconnect attempts exhausted. Reopen the connection to retry.'
          : 'The SSH session disconnected.';

  return (
    <div className="flex h-full flex-col relative">
      {/* Disconnected overlay — surfaces the live status (connecting / reconnecting
          / error) so the user can tell whether to wait or take action. */}
      {isDisconnected && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <WifiOff className="h-8 w-8 mx-auto text-destructive/60 mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground/80">Connection lost</p>
            <p className="mt-1 text-xs text-muted-foreground/60">{overlayMessage}</p>
          </div>
        </div>
      )}
      {/* Dual pane */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Local pane */}
        <div style={{ width: `${splitRatio * 100}%` }} className="overflow-hidden">
          <FilePane
            title="Local"
            path={localPath}
            entries={localEntries}
            isLoading={localLoading}
            error={localError}
            selection={localSelection}
            onPathChange={setLocalPath}
            onSelect={(name, multi) => {
              if (multi) {
                toggleLocalSelection(name);
              } else {
                setLocalSelection(new Set([name]));
              }
            }}
            onRefresh={() => invalidateLocal(localPath)}
            onDragStart={handleLocalDragStart}
            onDrop={handleLocalDrop}
            onFileOpen={handleLocalFileOpen}
            onDownload={handleLocalUpload}
            downloadLabel="Upload"
            showHidden={showHiddenFiles}
            onToggleHidden={toggleHiddenFiles}
            onSelectAll={() => setLocalSelection(new Set(localEntries.map((e) => e.name)))}
            side="local"
          />
        </div>

        {/* Resize handle */}
        <div
          className="relative w-px flex-shrink-0 cursor-col-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuenow={Math.round(splitRatio * 100)}
          aria-valuemin={20}
          aria-valuemax={80}
          tabIndex={0}
          onKeyDown={(e) => {
            // Keyboard-driven resize for non-mouse users.
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setSplitRatio((r) => Math.max(0.2, r - 0.02));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              setSplitRatio((r) => Math.min(0.8, r + 0.02));
            }
          }}
        >
          <div
            className={`absolute inset-0 bg-border ${resizing ? 'bg-primary/60' : 'hover:bg-primary/40'}`}
            style={{ transition: 'background-color 150ms' }}
          />
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute -left-1.5 -right-1.5 inset-y-0 cursor-col-resize"
          />
        </div>

        {/* Remote pane */}
        <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="overflow-hidden">
          <FilePane
            title="Remote"
            path={remotePath}
            entries={remoteEntries}
            isLoading={remoteLoading}
            error={remoteError}
            selection={remoteSelection}
            onPathChange={setRemotePath}
            onSelect={(name, multi) => {
              if (multi) {
                toggleRemoteSelection(name);
              } else {
                setRemoteSelection(new Set([name]));
              }
            }}
            onRefresh={() => invalidateSftp(activeSessionId!, remotePath)}
            onDragStart={handleRemoteDragStart}
            onDrop={handleRemoteDrop}
            onFileOpen={handleRemoteFileOpen}
            onRename={handleRemoteRename}
            onDelete={handleRemoteDelete}
            onCopyPath={handleRemoteCopyPath}
            onPreview={handleRemoteFileOpen}
            onDownload={handleRemoteDownload}
            downloadLabel="Download"
            showHidden={showHiddenFiles}
            onToggleHidden={toggleHiddenFiles}
            onMkdir={handleRemoteMkdir}
            onSelectAll={() => setRemoteSelection(new Set(remoteEntries.map((e) => e.name)))}
            side="remote"
            remoteKind={remoteKind}
          />
        </div>
      </div>

      {/* Transfer queue */}
      <TransferQueue />

      {/* File preview modal */}
      <FilePreview />

      {/* Rename dialog */}
      <PromptDialog
        open={!!renameTarget}
        title="Rename"
        message={`Rename "${renameTarget?.name ?? ''}"`}
        placeholder="New name"
        defaultValue={renameTarget?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete file?"
        message={`"${deleteTarget?.name ?? ''}" will be permanently deleted${deleteTarget?.isDirectory ? ' along with all its contents' : ''}. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* New folder dialog */}
      <PromptDialog
        open={mkdirOpen}
        title="New folder"
        placeholder="Folder name"
        confirmLabel="Create"
        onConfirm={handleMkdirConfirm}
        onCancel={() => setMkdirOpen(false)}
      />
    </div>
  );
}
