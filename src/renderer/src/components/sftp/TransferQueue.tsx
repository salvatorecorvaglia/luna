import { memo } from 'react';
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
import { cn } from '@/lib/utils';
import { useTransferStore } from '@/stores/transfer-store';
import { cancelTransfer } from '@/hooks/use-transfers';
import type { TransferItem } from '@shared/types/transfer';
import { toast } from 'sonner';
import { formatEta, formatSize, formatSpeed } from '@/lib/format';

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
          ? await window.api.sftp.download({
              sessionId: item.sessionId,
              remotePath: item.remotePath,
              localPath: item.localPath,
            })
          : await window.api.sftp.upload({
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
      toast.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const items = Array.from(transfers.values());
  if (items.length === 0) return null;

  const activeCount = items.filter((t) => t.status === 'active' || t.status === 'queued').length;
  const completedCount = items.filter((t) => t.status === 'completed').length;

  const cancelAll = () => {
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
        <button
          onClick={toggleQueueExpanded}
          aria-expanded={queueExpanded}
          aria-controls="transfer-queue-list"
          className="flex flex-1 items-center gap-2 hover:text-foreground cursor-pointer"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-medium" aria-live="polite">
            {summary}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              onClick={cancelAll}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
              aria-label="Cancel all active transfers"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Cancel all
            </button>
          )}
          <button
            onClick={toggleQueueExpanded}
            aria-label={queueExpanded ? 'Collapse transfer queue' : 'Expand transfer queue'}
            className="rounded p-0.5 hover:text-foreground cursor-pointer"
          >
            {queueExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
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
                <button
                  onClick={clearCompleted}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear completed
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
        <Upload className="h-3.5 w-3.5 text-info flex-shrink-0" aria-hidden="true" />
      ) : (
        <Download className="h-3.5 w-3.5 text-success flex-shrink-0" aria-hidden="true" />
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
                  item.type === 'upload' ? 'bg-blue-500' : 'bg-emerald-500',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
            {item.status === 'active'
              ? `${percent}% · ${formatSpeed(item.bytesPerSec)}${eta ? ` · ${eta} left` : ''}`
              : item.status === 'queued'
                ? 'Queued'
                : item.status === 'completed'
                  ? formatSize(item.size)
                  : item.error || 'Error'}
          </span>
        </div>
      </div>

      {/* Status icon */}
      <div className="flex-shrink-0" aria-hidden="true">
        {item.status === 'active' && <Loader2 className="h-3.5 w-3.5 text-info animate-spin" />}
        {item.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
        {item.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
      </div>

      {/* Retry (error only) */}
      {item.status === 'error' && (
        <button
          onClick={onRetry}
          title="Retry transfer"
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground cursor-pointer"
          aria-label="Retry transfer"
        >
          <RotateCw className="h-3 w-3" />
        </button>
      )}

      {/* Cancel / Remove */}
      <button
        onClick={handleRemove}
        title={isInProgress ? 'Cancel transfer' : 'Remove'}
        className="flex-shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-foreground cursor-pointer"
        aria-label={isInProgress ? 'Cancel transfer' : 'Remove'}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});
