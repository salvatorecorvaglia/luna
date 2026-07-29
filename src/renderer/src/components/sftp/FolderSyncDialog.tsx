import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightLeft, Download, FolderSync, RefreshCw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';
import type { FolderDiffItem, FolderDiffResult } from '@shared/types/folder-sync';

interface FolderSyncDialogProps {
  open: boolean;
  onClose: () => void;
  localPath: string;
  remotePath: string;
  sessionId: string;
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.1 } },
};

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function FolderSyncDialog({
  open,
  onClose,
  localPath,
  remotePath,
  sessionId,
}: FolderSyncDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [diffResult, setDiffResult] = useState<FolderDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [direction, setDirection] = useState<'sync-to-remote' | 'sync-to-local' | 'bi-directional'>(
    'sync-to-remote',
  );

  const runFolderComparison = useCallback(async () => {
    if (!localPath || !remotePath || !sessionId) return;
    setLoading(true);
    try {
      // List local files
      const localFiles = await window.api.shell.readdir(localPath);
      const localFormatted = localFiles
        .filter((f) => !f.isDirectory)
        .map((f) => ({ relativePath: f.name, size: f.size, mtime: f.modifiedAt }));

      // List remote files
      const remoteFiles = await window.api.storage.list({ sessionId, path: remotePath });

      // Compare
      const res = await window.api.storage.compareDirectories({
        localEntries: localFormatted,
        remoteEntries: remoteFiles,
        direction,
      });

      setDiffResult(res);
    } catch (err) {
      toast.error(`Folder comparison failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [localPath, remotePath, sessionId, direction]);

  useEffect(() => {
    if (!open) return;
    runFolderComparison();
  }, [open, runFolderComparison]);

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    return attachFocusTrap(dialog, { onEscape: onClose });
  }, [open, onClose]);

  const handleExecuteSync = async () => {
    if (!diffResult || diffResult.items.length === 0) return;
    setSyncing(true);
    let enqueued = 0;

    try {
      for (const item of diffResult.items) {
        if (item.recommendedAction === 'upload') {
          const lPath = await window.api.shell.joinPath(localPath, item.relativePath);
          const rPath = remotePath.endsWith('/')
            ? `${remotePath}${item.relativePath}`
            : `${remotePath}/${item.relativePath}`;

          await window.api.storage.upload({
            sessionId,
            localPath: lPath,
            remotePath: rPath,
          });
          enqueued++;
        } else if (item.recommendedAction === 'download') {
          const lPath = await window.api.shell.joinPath(localPath, item.relativePath);
          const rPath = remotePath.endsWith('/')
            ? `${remotePath}${item.relativePath}`
            : `${remotePath}/${item.relativePath}`;

          await window.api.storage.download({
            sessionId,
            localPath: lPath,
            remotePath: rPath,
          });
          enqueued++;
        }
      }

      toast.success(`Enqueued ${enqueued} differential sync transfer(s)`);
      onClose();
    } catch (err) {
      toast.error(`Sync execution failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: Z.modal }}
      >
        <motion.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-xs"
        />

        <motion.div
          ref={dialogRef}
          variants={dialogVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="relative flex flex-col w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FolderSync className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Differential Folder Synchronizer</h2>
                <p className="text-xs text-muted-foreground">
                  Compare local and remote folders side-by-side and execute differential sync
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Folder Paths & Controls */}
            <div className="rounded-lg border border-border bg-accent/20 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <span className="text-muted-foreground block text-[11px] mb-0.5">Local Directory:</span>
                  <span className="truncate block font-semibold" title={localPath}>
                    {localPath}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground block text-[11px] mb-0.5">Remote Storage Path:</span>
                  <span className="truncate block font-semibold" title={remotePath}>
                    {remotePath}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border/40 pt-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Sync Rule:</span>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as any)}
                    className="rounded border border-input bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="sync-to-remote">Local → Remote (Upload missing/modified)</option>
                    <option value="sync-to-local">Remote → Local (Download missing/modified)</option>
                    <option value="bi-directional">Bi-Directional (Sync newest files both ways)</option>
                  </select>
                </div>

                <button
                  onClick={runFolderComparison}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent cursor-pointer"
                >
                  <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Re-Compare
                </button>
              </div>
            </div>

            {/* Summary Counters */}
            {diffResult && (
              <div className="grid grid-cols-4 gap-3 text-center text-xs">
                <div className="rounded-lg border border-border p-2.5 bg-background">
                  <div className="text-muted-foreground text-[11px]">Only Local</div>
                  <div className="text-base font-bold text-primary mt-0.5">{diffResult.onlyLocalCount}</div>
                </div>

                <div className="rounded-lg border border-border p-2.5 bg-background">
                  <div className="text-muted-foreground text-[11px]">Only Remote</div>
                  <div className="text-base font-bold text-primary mt-0.5">{diffResult.onlyRemoteCount}</div>
                </div>

                <div className="rounded-lg border border-border p-2.5 bg-background">
                  <div className="text-muted-foreground text-[11px]">Modified</div>
                  <div className="text-base font-bold text-warning mt-0.5">{diffResult.modifiedCount}</div>
                </div>

                <div className="rounded-lg border border-border p-2.5 bg-background">
                  <div className="text-muted-foreground text-[11px]">Identical</div>
                  <div className="text-base font-bold text-success mt-0.5">{diffResult.identicalCount}</div>
                </div>
              </div>
            )}

            {/* Diff Items Table */}
            {loading ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Comparing folder checksums and timestamps...
              </div>
            ) : !diffResult || diffResult.items.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No files found in specified directories.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-60 overflow-y-auto font-mono text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs border-b border-border text-[11px] text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Relative File Path</th>
                        <th className="p-2.5 text-right">Local Size</th>
                        <th className="p-2.5 text-right">Remote Size</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {diffResult.items.map((item: FolderDiffItem) => (
                        <tr key={item.relativePath} className="hover:bg-accent/30 transition-colors">
                          <td className="p-2.5 truncate max-w-[200px]" title={item.relativePath}>
                            {item.relativePath}
                          </td>
                          <td className="p-2.5 text-right text-muted-foreground">
                            {formatBytes(item.localSize)}
                          </td>
                          <td className="p-2.5 text-right text-muted-foreground">
                            {formatBytes(item.remoteSize)}
                          </td>
                          <td className="p-2.5 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                item.status === 'identical'
                                  ? 'bg-success/10 text-success'
                                  : item.status === 'modified'
                                  ? 'bg-warning/10 text-warning'
                                  : 'bg-primary/10 text-primary'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            {item.recommendedAction === 'upload' && (
                              <span className="inline-flex items-center gap-1 text-primary text-[11px] font-semibold">
                                <Upload className="size-3" /> Upload
                              </span>
                            )}
                            {item.recommendedAction === 'download' && (
                              <span className="inline-flex items-center gap-1 text-primary text-[11px] font-semibold">
                                <Download className="size-3" /> Download
                              </span>
                            )}
                            {item.recommendedAction === 'skip' && (
                              <span className="text-muted-foreground/60 text-[11px]">Skip</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 bg-muted/20 text-xs">
            <span className="text-muted-foreground">
              {diffResult
                ? `${diffResult.items.filter((i: FolderDiffItem) => i.recommendedAction !== 'skip').length} transfer(s) ready to execute`
                : ''}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleExecuteSync}
                disabled={syncing || !diffResult || diffResult.items.every((i: FolderDiffItem) => i.recommendedAction === 'skip')}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <ArrowRightLeft className="size-3.5" />
                Execute Sync
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
