import type { FolderDiffItem, FolderDiffResult } from '@shared/types/folder-sync';
import { ArrowRightLeft, Download, FolderSync, RefreshCw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { EmptyState, Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

interface FolderSyncDialogProps {
  open: boolean;
  onClose: () => void;
  localPath: string;
  remotePath: string;
  sessionId: string;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function FolderSyncDialog({
  open,
  onClose,
  localPath,
  remotePath,
  sessionId,
}: FolderSyncDialogProps) {
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
      const localFiles = await getApi().shell.readdir(localPath);
      const localFormatted = localFiles
        .filter((f) => !f.isDirectory)
        .map((f) => ({ relativePath: f.name, size: f.size, mtime: f.modifiedAt }));

      // List remote files
      const remoteFiles = await getApi().storage.list({ sessionId, path: remotePath });

      // Compare
      const res = await getApi().storage.compareDirectories({
        sessionId,
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

  const handleExecuteSync = async () => {
    if (!diffResult || diffResult.items.length === 0) return;
    setSyncing(true);

    // Each file is enqueued independently. The loop used to abort on the first
    // rejection, so one unwritable path left the user with a partial sync, a
    // generic error, and no way to tell which files had actually been queued.
    // Failures are collected instead and reported alongside the successes.
    const failures: { relativePath: string; message: string }[] = [];
    let enqueued = 0;

    try {
      for (const item of diffResult.items) {
        const direction =
          item.recommendedAction === 'upload'
            ? 'upload'
            : item.recommendedAction === 'download'
              ? 'download'
              : null;
        if (!direction) continue;

        try {
          const lPath = await getApi().shell.joinPath(localPath, item.relativePath);
          const rPath = remotePath.endsWith('/')
            ? `${remotePath}${item.relativePath}`
            : `${remotePath}/${item.relativePath}`;

          await getApi().storage[direction]({
            sessionId,
            localPath: lPath,
            remotePath: rPath,
          });
          enqueued++;
        } catch (err) {
          failures.push({
            relativePath: item.relativePath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (failures.length === 0) {
        toast.success(`Enqueued ${enqueued} differential sync transfer(s)`);
        onClose();
      } else if (enqueued === 0) {
        // Nothing got through — keep the dialog open so the user can retry
        // without re-running the comparison. Non-null: this branch only runs
        // when failures.length > 0 (the `=== 0` case above already returned).
        toast.error(`Sync failed: no transfers could be queued. ${failures[0]!.message}`);
      } else {
        toast.warning(`Enqueued ${enqueued} transfer(s); ${failures.length} could not be queued`, {
          description: failures
            .slice(0, 3)
            .map((f) => `${f.relativePath}: ${f.message}`)
            .join('\n'),
          duration: 10000,
        });
        onClose();
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="folder-sync-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderSync className="size-5" />
          </div>
          <div>
            <h2 id="folder-sync-dialog-title" className="text-base font-semibold">
              Differential Folder Synchronizer
            </h2>
            {/*
                  Says "files in this folder", not "folders", on purpose: the
                  comparison lists one level and filters directories out
                  (`!f.isDirectory` in runFolderComparison), so a tree that
                  differs only inside a subdirectory reports zero differences.
                  Describing it as a folder sync made that read as "everything
                  is up to date" rather than "subfolders weren't examined".
                */}
            <p className="text-xs text-muted-foreground">
              Compare files in this folder and queue the differences. Subfolders are not examined.
            </p>
          </div>
        </div>

        <button
          type="button"
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
              <span className="text-muted-foreground block text-2xs mb-0.5">Local Directory:</span>
              <span className="truncate block font-semibold" title={localPath}>
                {localPath}
              </span>
            </div>

            <div>
              <span className="text-muted-foreground block text-2xs mb-0.5">
                Remote Storage Path:
              </span>
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
                onChange={(e) =>
                  setDirection(
                    e.target.value as 'sync-to-remote' | 'sync-to-local' | 'bi-directional',
                  )
                }
                className="rounded border border-input bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="sync-to-remote">Local → Remote (Upload missing/modified)</option>
                <option value="sync-to-local">Remote → Local (Download missing/modified)</option>
                <option value="bi-directional">Bi-Directional (Sync newest files both ways)</option>
              </select>
            </div>

            <button
              type="button"
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
              <div className="text-muted-foreground text-2xs">Only Local</div>
              <div className="text-base font-bold text-primary mt-0.5">
                {diffResult.onlyLocalCount}
              </div>
            </div>

            <div className="rounded-lg border border-border p-2.5 bg-background">
              <div className="text-muted-foreground text-2xs">Only Remote</div>
              <div className="text-base font-bold text-primary mt-0.5">
                {diffResult.onlyRemoteCount}
              </div>
            </div>

            <div className="rounded-lg border border-border p-2.5 bg-background">
              <div className="text-muted-foreground text-2xs">Modified</div>
              <div className="text-base font-bold text-warning mt-0.5">
                {diffResult.modifiedCount}
              </div>
            </div>

            <div className="rounded-lg border border-border p-2.5 bg-background">
              <div className="text-muted-foreground text-2xs">Identical</div>
              <div className="text-base font-bold text-success mt-0.5">
                {diffResult.identicalCount}
              </div>
            </div>
          </div>
        )}

        {/* Diff Items Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="md" label="Comparing folder checksums and timestamps…" />
          </div>
        ) : !diffResult || diffResult.items.length === 0 ? (
          <EmptyState title="No files found in specified directories." className="py-10" />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="max-h-60 overflow-y-auto font-mono text-xs">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs border-b border-border text-2xs text-muted-foreground">
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
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-medium ${
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
                          <span className="inline-flex items-center gap-1 text-primary text-2xs font-semibold">
                            <Upload className="size-3" /> Upload
                          </span>
                        )}
                        {item.recommendedAction === 'download' && (
                          <span className="inline-flex items-center gap-1 text-primary text-2xs font-semibold">
                            <Download className="size-3" /> Download
                          </span>
                        )}
                        {item.recommendedAction === 'skip' && (
                          <span className="text-muted-foreground/60 text-2xs">Skip</span>
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
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleExecuteSync}
            disabled={
              syncing ||
              !diffResult ||
              diffResult.items.every((i: FolderDiffItem) => i.recommendedAction === 'skip')
            }
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="size-3.5" />
            Execute Sync
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
