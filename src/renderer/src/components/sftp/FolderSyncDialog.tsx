import { toastArgs } from '@shared/error-messages';
import type { FolderDiffResult } from '@shared/types/folder-sync';
import { ArrowRightLeft, FolderSync, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { Button, EmptyState, IconButton, Spinner } from '@/components/ui';
import { enqueueTransfer } from '@/lib/transfers';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
import { FolderSyncResults, type SyncChoice } from './FolderSyncResults';

interface FolderSyncDialogProps {
  open: boolean;
  onClose: () => void;
  localPath: string;
  remotePath: string;
  sessionId: string;
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

  const [choices, setChoices] = useState(new Map<string, SyncChoice>());
  const [queued, setQueued] = useState(new Set<string>());
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [comparedKey, setComparedKey] = useState<string | null>(null);
  const comparisonKey = JSON.stringify([localPath, remotePath, sessionId, direction]);
  const executing = useRef(false);
  const executionId = useRef(0);
  const current = comparedKey === comparisonKey;
  const counts = useMemo(() => {
    let ready = 0;
    let unresolved = 0;
    for (const item of diffResult?.items ?? []) {
      if (queued.has(item.relativePath)) continue;
      const action = choices.get(item.relativePath) ?? item.recommendedAction;
      if (action === 'conflict') unresolved++;
      if (action === 'upload' || action === 'download') ready++;
    }
    return { ready, unresolved };
  }, [diffResult, choices, queued]);
  const handleClose = useCallback(() => {
    executionId.current++;
    requestIdRef.current++;
    onClose();
  }, [onClose]);

  // Only the latest comparison may publish its result. Switching direction
  // re-runs the comparison, and an older response landing last used to leave a
  // diff for the *previous* direction on screen — which Execute would then run,
  // uploading over remote files the user had asked to download.
  const requestIdRef = useRef(0);

  const runFolderComparison = useCallback(async () => {
    if (!localPath || !remotePath || !sessionId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    // Drop the previous diff at once so it can't be executed while the new one loads.
    setDiffResult(null);
    setComparedKey(null);
    setChoices(new Map());
    setQueued(new Set());
    setFailures([]);
    setComparisonError(null);
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

      if (requestId !== requestIdRef.current) return;
      setDiffResult(res);
      setComparedKey(comparisonKey);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setComparisonError(err instanceof Error ? err.message : String(err));
      toast.error(...toastArgs(err, 'Folder comparison failed'));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [localPath, remotePath, sessionId, direction, comparisonKey]);

  useEffect(() => {
    if (!open) return;
    void runFolderComparison();
    return () => {
      requestIdRef.current++;
      executionId.current++;
    };
  }, [open, runFolderComparison]);

  const handleExecuteSync = async () => {
    if (
      executing.current ||
      loading ||
      !current ||
      !diffResult ||
      counts.unresolved > 0 ||
      counts.ready === 0
    )
      return;
    executing.current = true;
    const run = ++executionId.current;
    setSyncing(true);
    setFailures([]);
    const accepted = new Set(queued);

    // Each file is enqueued independently. The loop used to abort on the first
    // rejection, so one unwritable path left the user with a partial sync, a
    // generic error, and no way to tell which files had actually been queued.
    // Failures are collected instead and reported alongside the successes.
    const failures: { relativePath: string; message: string }[] = [];
    let enqueued = 0;

    try {
      for (const item of diffResult.items) {
        if (run !== executionId.current) return;
        if (accepted.has(item.relativePath)) continue;
        const action = choices.get(item.relativePath) ?? item.recommendedAction;
        const direction = action === 'upload' || action === 'download' ? action : null;
        if (!direction) continue;

        try {
          const lPath = await getApi().shell.joinPath(localPath, item.relativePath);
          const rPath = remotePath.endsWith('/')
            ? `${remotePath}${item.relativePath}`
            : `${remotePath}/${item.relativePath}`;

          if (run !== executionId.current) return;
          await enqueueTransfer({
            type: direction,
            sessionId,
            localPath: lPath,
            remotePath: rPath,
            fileName: item.relativePath,
            size: (direction === 'upload' ? item.localSize : item.remoteSize) ?? 0,
          });
          enqueued++;
          accepted.add(item.relativePath);
          if (run === executionId.current) setQueued(new Set(accepted));
        } catch (err) {
          failures.push({
            relativePath: item.relativePath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (run !== executionId.current) return;
      setFailures(failures.map((file) => `${file.relativePath}: ${file.message}`));
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
      }
    } finally {
      executing.current = false;
      setSyncing(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="folder-sync-dialog-title"
      ariaDescribedBy="folder-sync-limitations"
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
              Compare file sizes and timestamps in this folder. Subfolders are not examined.
            </p>
          </div>
        </div>

        <IconButton
          onClick={handleClose}
          aria-label="Close dialog"
          title="Close"
          size="md"
          icon={<X className="size-4" />}
        />
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
              <label htmlFor="folder-sync-direction" className="text-muted-foreground">
                Sync rule:
              </label>
              <select
                id="folder-sync-direction"
                disabled={syncing}
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
              disabled={loading || syncing}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-accent cursor-pointer"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Re-Compare
            </button>
          </div>
        </div>

        <p id="folder-sync-limitations" className="text-xs text-muted-foreground">
          File contents are not compared, so same-size edits can be missed.{' '}
          {direction === 'bi-directional'
            ? 'Newest-wins uses timestamps and cannot detect changes made on both sides.'
            : 'One-way rules skip same-size sources with older timestamps.'}{' '}
          Uploads replace remote files; downloads replace local files.
        </p>
        {failures.length > 0 && (
          <p role="alert" className="text-xs text-warning">
            Could not queue {failures.length} file(s). Retry the remaining transfers; already queued
            files will not be queued again. {failures.slice(0, 3).join('; ')}
          </p>
        )}

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
              <div className="text-muted-foreground text-2xs">No change suggested</div>
              <div className="text-base font-bold text-success mt-0.5">
                {diffResult.identicalCount}
              </div>
            </div>
          </div>
        )}

        {/* Diff Items Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="md" label="Comparing file sizes and timestamps…" />
          </div>
        ) : comparisonError ? (
          <EmptyState title="Comparison failed" description={comparisonError} className="py-10" />
        ) : !diffResult || diffResult.items.length === 0 ? (
          <EmptyState title="No files found in specified directories." className="py-10" />
        ) : (
          <FolderSyncResults
            items={diffResult.items}
            choices={choices}
            queued={queued}
            disabled={syncing}
            onChoose={(path, choice) =>
              setChoices((previous) => new Map(previous).set(path, choice))
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 bg-muted/20 text-xs">
        <span role="status" className="text-muted-foreground">
          {diffResult && current
            ? `${counts.ready} transfer(s) ready; ${counts.unresolved} unresolved conflict(s); ${queued.size} queued`
            : ''}
          {syncing && ' Stopping queueing leaves transfers already queued running.'}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent transition-colors cursor-pointer"
          >
            {syncing ? 'Stop queueing' : 'Cancel'}
          </button>

          <Button
            onClick={handleExecuteSync}
            loading={syncing}
            disabled={
              loading || !current || !diffResult || counts.unresolved > 0 || counts.ready === 0
            }
            leadingIcon={<ArrowRightLeft className="size-3.5" />}
          >
            Execute Sync
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
