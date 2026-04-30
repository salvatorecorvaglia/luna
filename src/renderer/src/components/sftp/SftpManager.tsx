import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Unplug, Plus, WifiOff } from 'lucide-react'
import { useSftpStore } from '@/stores/sftp-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useTransferStore } from '@/stores/transfer-store'
import { useConnectionStore } from '@/stores/connection-store'
import {
  useSftpDirectory,
  useLocalDirectory,
  useInvalidateSftp,
  useInvalidateLocalDir
} from '@/hooks/use-sftp'
import { FilePane, type FileEntry } from './FilePane'
import { TransferQueue } from './TransferQueue'
import { FilePreview } from './FilePreview'
import { PromptDialog } from '@/components/common/PromptDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

export function SftpManager() {
  const localPath = useSftpStore((s) => s.localPath)
  const remotePath = useSftpStore((s) => s.remotePath)
  const localSelection = useSftpStore((s) => s.localSelection)
  const remoteSelection = useSftpStore((s) => s.remoteSelection)
  const sftpSessionId = useSftpStore((s) => s.sftpSessionId)
  const setLocalPath = useSftpStore((s) => s.setLocalPath)
  const setRemotePath = useSftpStore((s) => s.setRemotePath)
  const toggleLocalSelection = useSftpStore((s) => s.toggleLocalSelection)
  const toggleRemoteSelection = useSftpStore((s) => s.toggleRemoteSelection)
  const setSftpSessionId = useSftpStore((s) => s.setSftpSessionId)
  const setLocalSelection = useSftpStore((s) => s.setLocalSelection)
  const setRemoteSelection = useSftpStore((s) => s.setRemoteSelection)
  const showHiddenFiles = useSftpStore((s) => s.showHiddenFiles)
  const toggleHiddenFiles = useSftpStore((s) => s.toggleHiddenFiles)

  const sessions = useTerminalStore((s) => s.sessions)
  const invalidateSftp = useInvalidateSftp()
  const invalidateLocal = useInvalidateLocalDir()
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [resizing, setResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-select first connected session if none selected
  useEffect(() => {
    if (!sftpSessionId) {
      const connected = Array.from(sessions.values()).find((s) => s.status === 'connected')
      if (connected) {
        setSftpSessionId(connected.id)
      }
    }
  }, [sessions, sftpSessionId, setSftpSessionId])

  // Set local path to home directory on mount
  useEffect(() => {
    if (!localPath) {
      window.api.shell
        .homeDir()
        .then(setLocalPath)
        .catch(() => {
          setLocalPath('/')
        })
    }
  }, [localPath, setLocalPath])

  const {
    data: remoteEntries = [],
    isLoading: remoteLoading,
    error: remoteError
  } = useSftpDirectory(sftpSessionId, remotePath)

  const {
    data: localEntries = [],
    isLoading: localLoading,
    error: localError
  } = useLocalDirectory(localPath)

  const addTransfer = useTransferStore((s) => s.addTransfer)

  // Drag-and-drop: remote -> local (download)
  const handleLocalDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const remoteSrc = e.dataTransfer.getData('remote-path')
      const fileName = e.dataTransfer.getData('file-name')
      const fileSize = parseInt(e.dataTransfer.getData('file-size') || '0', 10)
      const isDirectory = e.dataTransfer.getData('is-directory') === 'true'
      if (!remoteSrc || !sftpSessionId) return

      // Warn and skip directory transfers (not yet supported)
      if (isDirectory) {
        toast.warning('Directory transfers are not yet supported. Please transfer individual files.')
        return
      }

      const localDest = await window.api.shell.joinPath(localPath, fileName)
      try {
        const transferId = await window.api.sftp.download({
          sessionId: sftpSessionId,
          remotePath: remoteSrc,
          localPath: localDest
        })
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
          sessionId: sftpSessionId
        })
      } catch (err: unknown) {
        toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [sftpSessionId, localPath, addTransfer]
  )

  // Drag-and-drop: local -> remote (upload)
  const handleRemoteDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const localSrc = e.dataTransfer.getData('local-path')
      const rawFileName = e.dataTransfer.getData('file-name')
      const fileSize = parseInt(e.dataTransfer.getData('file-size') || '0', 10)
      const isDirectory = e.dataTransfer.getData('is-directory') === 'true'
      if (!localSrc || !sftpSessionId) return

      // Warn and skip directory transfers (not yet supported)
      if (isDirectory) {
        toast.warning('Directory transfers are not yet supported. Please transfer individual files.')
        return
      }

      // Sanitize filename to prevent path traversal
      const fileName = rawFileName.split('/').pop()?.split('\\').pop() || rawFileName
      const remoteDest = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`
      try {
        const transferId = await window.api.sftp.upload({
          sessionId: sftpSessionId,
          localPath: localSrc,
          remotePath: remoteDest
        })
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
          sessionId: sftpSessionId
        })
      } catch (err: unknown) {
        toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [sftpSessionId, remotePath, addTransfer]
  )

  const handleLocalDragStart = useCallback((entry: FileEntry, e: React.DragEvent) => {
    e.dataTransfer.setData('local-path', entry.path)
    e.dataTransfer.setData('file-name', entry.name)
    e.dataTransfer.setData('file-size', String(entry.size || 0))
    e.dataTransfer.setData('is-directory', String(entry.isDirectory))
  }, [])

  const handleRemoteDragStart = useCallback((entry: FileEntry, e: React.DragEvent) => {
    e.dataTransfer.setData('remote-path', entry.path)
    e.dataTransfer.setData('file-name', entry.name)
    e.dataTransfer.setData('file-size', String(entry.size || 0))
    e.dataTransfer.setData('is-directory', String(entry.isDirectory))
  }, [])

  // Dialog state for rename, delete, mkdir
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [mkdirOpen, setMkdirOpen] = useState(false)

  const setPreviewFile = useSftpStore((s) => s.setPreviewFile)

  // Preview remote file on double-click
  const handleRemoteFileOpen = useCallback(
    async (entry: FileEntry) => {
      if (!sftpSessionId) return
      try {
        const content = await window.api.sftp.readFile({
          sessionId: sftpSessionId,
          path: entry.path
        })
        const ext = entry.name.split('.').pop()?.toLowerCase() || ''
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']
        const type = imageExts.includes(ext)
          ? `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`
          : 'text/plain'
        setPreviewFile({ name: entry.name, content, type })
      } catch (err: unknown) {
        toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [sftpSessionId, setPreviewFile]
  )

  // Preview local file on double-click
  const handleLocalFileOpen = useCallback(
    async (entry: FileEntry) => {
      try {
        // Read local file via the SFTP readFile only works for remote; use a simple approach:
        // For text files, use the main process readdir/path utilities aren't designed for content.
        // Instead, we download to a temp preview. For now, show a toast with the path.
        const ext = entry.name.split('.').pop()?.toLowerCase() || ''
        const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'xml', 'csv', 'log', 'sh', 'bash',
                          'zsh', 'py', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'scss', 'conf',
                          'cfg', 'ini', 'toml', 'env', 'gitignore', 'editorconfig', 'Makefile',
                          'Dockerfile', 'rs', 'go', 'rb', 'php', 'java', 'c', 'h', 'cpp']
        const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']
        if (!textExts.includes(ext) && !imageExts.includes(ext)) {
          toast.info(`Cannot preview .${ext} files. Use your system file manager to open.`)
          return
        }
        // For local preview, we can't use the SFTP readFile API — show a message
        // pointing users to use the system file manager for non-remote files.
        toast.info(`Local file: ${entry.path}\nOpen in your system file manager to preview.`)
      } catch (err: unknown) {
        toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    []
  )

  // Rename remote file/directory
  const handleRemoteRename = useCallback((entry: FileEntry) => {
    setRenameTarget(entry)
  }, [])

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!sftpSessionId || !renameTarget) return
      setRenameTarget(null)
      if (newName === renameTarget.name) return

      const parentPath = renameTarget.path.substring(0, renameTarget.path.lastIndexOf('/')) || '/'
      const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`
      try {
        await window.api.sftp.rename({
          sessionId: sftpSessionId,
          oldPath: renameTarget.path,
          newPath
        })
        toast.success(`Renamed to ${newName}`)
        invalidateSftp(sftpSessionId, remotePath)
      } catch (err: unknown) {
        toast.error(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [sftpSessionId, remotePath, invalidateSftp, renameTarget]
  )

  // Delete remote file/directory
  const handleRemoteDelete = useCallback((entry: FileEntry) => {
    setDeleteTarget(entry)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!sftpSessionId || !deleteTarget) return
    const entry = deleteTarget
    setDeleteTarget(null)

    try {
      await window.api.sftp.delete({
        sessionId: sftpSessionId,
        path: entry.path,
        isDirectory: entry.isDirectory
      })
      toast.success(`Deleted ${entry.name}`)
      invalidateSftp(sftpSessionId, remotePath)
    } catch (err: unknown) {
      toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [sftpSessionId, remotePath, invalidateSftp, deleteTarget])

  // Copy remote path to clipboard
  const handleRemoteCopyPath = useCallback((entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path)
    toast.success('Path copied to clipboard')
  }, [])

  // Create directory on remote
  const handleRemoteMkdir = useCallback(() => {
    setMkdirOpen(true)
  }, [])

  const handleMkdirConfirm = useCallback(
    async (name: string) => {
      if (!sftpSessionId) return
      setMkdirOpen(false)

      const newPath = remotePath === '/' ? `/${name}` : `${remotePath}/${name}`
      try {
        await window.api.sftp.mkdir({ sessionId: sftpSessionId, path: newPath })
        toast.success(`Created folder "${name}"`)
        invalidateSftp(sftpSessionId, remotePath)
      } catch (err: unknown) {
        toast.error(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [sftpSessionId, remotePath, invalidateSftp]
  )

  // Resize handle
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setResizing(true)
    let rafId: number | null = null
    let pending: number | null = null
    const flush = (): void => {
      rafId = null
      if (pending !== null) {
        setSplitRatio(pending)
        pending = null
      }
    }
    const onMouseMove = (e: MouseEvent): void => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      pending = Math.max(0.2, Math.min(0.8, ratio))
      if (rafId === null) rafId = requestAnimationFrame(flush)
    }
    const onMouseUp = (): void => {
      setResizing(false)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        flush()
      }
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  if (!sftpSessionId || !sessions.get(sftpSessionId)) {
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
    )
  }

  // Show warning overlay when session disconnects mid-use
  const activeSession = sessions.get(sftpSessionId)
  const isDisconnected = activeSession && activeSession.status !== 'connected'

  return (
    <div className="flex h-full flex-col relative">
      {/* U11: Disconnected overlay */}
      {isDisconnected && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <WifiOff className="h-8 w-8 mx-auto text-destructive/60 mb-2" />
            <p className="text-sm font-medium text-foreground/80">Connection lost</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              The SSH session disconnected. Reconnecting…
            </p>
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
            onSelect={toggleLocalSelection}
            onRefresh={() => invalidateLocal(localPath)}
            onDragStart={handleLocalDragStart}
            onDrop={handleLocalDrop}
            onFileOpen={handleLocalFileOpen}
            showHidden={showHiddenFiles}
            onToggleHidden={toggleHiddenFiles}
            onSelectAll={() => setLocalSelection(new Set(localEntries.map((e) => e.name)))}
            side="local"
          />
        </div>

        {/* Resize handle */}
        <div className="relative w-px flex-shrink-0 cursor-col-resize">
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
            onSelect={toggleRemoteSelection}
            onRefresh={() => invalidateSftp(sftpSessionId!, remotePath)}
            onDragStart={handleRemoteDragStart}
            onDrop={handleRemoteDrop}
            onFileOpen={handleRemoteFileOpen}
            onRename={handleRemoteRename}
            onDelete={handleRemoteDelete}
            onCopyPath={handleRemoteCopyPath}
            onPreview={handleRemoteFileOpen}
            showHidden={showHiddenFiles}
            onToggleHidden={toggleHiddenFiles}
            onMkdir={handleRemoteMkdir}
            onSelectAll={() => setRemoteSelection(new Set(remoteEntries.map((e) => e.name)))}
            side="remote"
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
  )
}
