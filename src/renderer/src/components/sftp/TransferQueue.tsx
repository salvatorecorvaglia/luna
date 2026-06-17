import { toastArgs } from '@shared/error-messages';
import type { TransferErrorClass, TransferItem } from '@shared/types/transfer';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RotateCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { memo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { cancelTransfer } from '@/hooks/use-transfers';
import { formatEta, formatSize, formatSpeed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTransferStore } from '@/stores/transfer-store';

export function TransferQueue() {
  const {
    transfers,
    queueExpanded,
    toggleQueueExpanded,
    clearCompleted,
    removeTransfer,
    addTransfer,
  } = useTransferStore();

  const retryTransfer = async (item: TransferItem) => {
    removeTransfer(item.id);
    try {
      const transferId =
        item.type === 'download'
          ? await window.api.storage.download({
              sessionId: item.sessionId,
              remotePath: item.remotePath,
              localPath: item.localPath,
            })
          : await window.api.storage.upload({
              sessionId: item.sessionId,
              localPath: item.localPath,
              remotePath: item.remotePath,
            });
      addTransfer({
        id: transferId,
        type: item.type,
        localPath: item.localPath,
        remotePath: item.remotePath,
        fileName: item.fileName,
        size: item.size,
        transferred: 0,
        status: 'queued',
        bytesPerSec: 0,
        sessionId: item.sessionId,
      });
    } catch (err: unknown) {
      toast.error(...toastArgs(err, 'Retry failed'));
    }
  };

  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const items = Array.from(transfers.values());

  // Empty state stays visible (not `return null`) so the queue surface is
  // discoverable. Without it new users have no signal that drag-and-drop
  // between the panes is what kicks transfers off.
  if (items.length === 0) {
    return (
      <div className="border-t border-border/60 bg-card/80">
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground/70 no-select">
          <Upload className="size-3" aria-hidden="true" />
          <span>No transfers — drag files between panes to start</span>
        </div>
      </div>
    );
  }

  const activeCount = items.filter((t) => t.status === 'active' || t.status === 'queued').length;
  const completedCount = items.filter((t) => t.status === 'completed').length;

  const cancelAll = (): void => {
    for (const item of items) {
      if (item.status === 'active' || item.status === 'queued') {
        cancelTransfer(item.id);
        removeTransfer(item.id);
      }
    }
  };

  const summary =
    activeCount === 0 && completedCount === 0
      ? 'No transfers'
      : [
          activeCount > 0 ? `${activeCount} active` : null,
          completedCount > 0 ? `${completedCount} completed` : null,
        ]
          .filter(Boolean)
          .join(', ');

  return (
    <div className="border-t border-border/60 bg-card/80">
      {/* Toggle bar */}
      <div className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-muted-foreground no-select">
        {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
        <button
          onClick={toggleQueueExpanded}
          aria-expanded={queueExpanded}
          aria-controls="transfer-queue-list"
          className="flex flex-1 items-center gap-2 hover:text-foreground cursor-pointer"
        >
          <Upload className="size-3.5" aria-hidden="true" />
          <span className="font-medium" aria-live="polite">
            {summary}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            // biome-ignore lint/a11y/useButtonType: suppressed during migration
            <button
              onClick={() => setConfirmCancelOpen(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
              aria-label="Cancel all active transfers"
            >
              <X className="size-3" aria-hidden="true" />
              Cancel all
            </button>
          )}
          {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
          <button
            onClick={toggleQueueExpanded}
            aria-label={queueExpanded ? 'Collapse transfer queue' : 'Expand transfer queue'}
            className="rounded p-0.5 hover:text-foreground cursor-pointer"
          >
            {queueExpanded ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {queueExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div id="transfer-queue-list" className="max-h-[30vh] overflow-y-auto">
              {items.map((item) => (
                <TransferRow
                  key={item.id}
                  item={item}
                  onRemove={() => removeTransfer(item.id)}
                  onRetry={() => retryTransfer(item)}
                />
              ))}
            </div>

            {completedCount > 0 && (
              <div className="flex justify-end border-t border-border/60 px-3 py-1">
                {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
                <button
                  onClick={clearCompleted}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Trash2 className="size-3" />
                  Clear completed
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel all active transfers?"
        message={
          activeCount === 1
            ? 'The one in-flight transfer will be aborted. Partially-downloaded files are removed; partially-uploaded files may need manual cleanup on the remote.'
            : `${activeCount} in-flight transfers will be aborted. Partially-downloaded files are removed; partially-uploaded files may need manual cleanup on the remote.`
        }
        confirmLabel="Cancel all"
        cancelLabel="Keep running"
        destructive
        onConfirm={() => {
          setConfirmCancelOpen(false);
          cancelAll();
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}

/**
 * Map a coarse error class to an actionable user-facing hint. Falls back to
 * the raw error string when the class is missing or generic so we never hide
 * the original message.
 */
function errorHint(
  errorClass: TransferErrorClass | undefined,
  fallback: string | undefined,
): string {
  switch (errorClass) {
    case 'permission':
      return 'Permission denied — check file permissions or credentials.';
    case 'disk-full':
      return 'Disk full — free up space and retry.';
    case 'connection':
      return 'Connection lost — reconnect and retry.';
    case 'timeout':
      return 'Operation timed out — retry or check the network.';
    case 'cancelled':
      return 'Cancelled.';
    default:
      return fallback || 'Transfer failed.';
  }
}

const TransferRow = memo(function TransferRow({
  item,
  onRemove,
  onRetry,
}: {
  item: TransferItem;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const percent = item.size > 0 ? Math.round((item.transferred / item.size) * 100) : 0;
  const isInProgress = item.status === 'active' || item.status === 'queued';
  const eta = formatEta(item.size - item.transferred, item.bytesPerSec);

  const handleRemove = () => {
    if (isInProgress) {
      cancelTransfer(item.id);
    }
    onRemove();
  };

  return (
    <div className="flex items-center gap-2.5 border-t border-border/40 px-3 py-2">
      {/* Icon */}
      {item.type === 'upload' ? (
        <Upload className="size-3.5 text-info flex-shrink-0" aria-hidden="true" />
      ) : (
        <Download className="size-3.5 text-success flex-shrink-0" aria-hidden="true" />
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{item.fileName}</div>
        <div className="mt-1 flex items-center gap-2">
          {/* Progress bar */}
          {isInProgress && (
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  item.type === 'upload' ? 'bg-info' : 'bg-success',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <span
            className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums"
            title={item.status === 'error' ? item.error : undefined}
          >
            {item.status === 'active'
              ? `${percent}% · ${formatSpeed(item.bytesPerSec)}${eta ? ` · ${eta} left` : ''}`
              : item.status === 'queued'
                ? 'Queued'
                : item.status === 'completed'
                  ? formatSize(item.size)
                  : errorHint(item.errorClass, item.error)}
          </span>
        </div>
      </div>

      {/* Status icon */}
      <div className="flex-shrink-0" aria-hidden="true">
        {item.status === 'active' && <Loader2 className="size-3.5 text-info animate-spin" />}
        {item.status === 'completed' && <CheckCircle2 className="size-3.5 text-success" />}
        {item.status === 'error' && <AlertCircle className="size-3.5 text-destructive" />}
      </div>

      {/* Retry (error only) */}
      {item.status === 'error' && (
        // biome-ignore lint/a11y/useButtonType: suppressed during migration
        <button
          onClick={onRetry}
          title="Retry transfer"
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground cursor-pointer"
          aria-label="Retry transfer"
        >
          <RotateCw className="size-3" />
        </button>
      )}

      {/* Cancel / Remove */}
      {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
      <button
        onClick={handleRemove}
        title={isInProgress ? 'Cancel transfer' : 'Remove'}
        className="flex-shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground cursor-pointer"
        aria-label={isInProgress ? 'Cancel transfer' : 'Remove'}
      >
        <X className="size-3" />
      </button>
    </div>
  );
});
