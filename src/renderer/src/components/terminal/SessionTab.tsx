import { Reorder } from 'framer-motion';
import { Monitor, WifiOff, X } from 'lucide-react';
import { memo } from 'react';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { Spinner } from '@/components/ui';
import { handleTabKeyDown } from '@/lib/roving-tabs';
import { cn } from '@/lib/utils';
import { getTabSession, useTerminalStore } from '@/stores/terminal-store';

/** Shared tab chrome; parents supply SSH/local actions and close policies. */
export const SessionTab = memo(function SessionTab({
  tabId,
  isActive,
  tabbable,
  contextItems,
  onActivate,
  onClose,
}: {
  tabId: string;
  isActive: boolean;
  tabbable: boolean;
  contextItems: ContextMenuItem[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const session = useTerminalStore((s) => getTabSession(s, tabId));
  if (!session) return null;
  const local = session.type === 'local';
  const title = session.title || (local ? 'Local' : session.connectionName);
  const status =
    session.status === 'connected' ? (
      <div className="size-2 rounded-full bg-success" />
    ) : session.status === 'connecting' || session.status === 'reconnecting' ? (
      <Spinner size="xs" className="text-warning" />
    ) : session.status === 'error' ? (
      <WifiOff className="size-3 text-destructive-fg" />
    ) : (
      <div className="size-2 rounded-full bg-muted-foreground/30" />
    );
  return (
    <Reorder.Item
      initial={false}
      transition={{ duration: 0 }}
      value={tabId}
      as="div"
      role="tab"
      aria-selected={isActive}
      aria-label={title}
      data-tab-id={tabId}
      tabIndex={tabbable ? 0 : -1}
      onKeyDown={(event) => handleTabKeyDown(event, () => onActivate(tabId))}
      className={cn(
        'group relative flex h-9 min-w-[90px] max-w-[200px] items-center gap-2 border-r border-border/40 px-3 text-xs cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
      )}
      whileDrag={{ opacity: 0.8, scale: 1.02, zIndex: 10 }}
      onClick={() => onActivate(tabId)}
    >
      <ContextMenu items={contextItems}>
        <div className="flex h-full w-full items-center gap-2">
          {isActive && <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />}
          {local ? (
            <Monitor
              className={cn('size-3', isActive ? 'text-primary' : 'text-muted-foreground/50')}
              aria-hidden="true"
            />
          ) : (
            <span
              role="img"
              aria-label={`Status: ${session.status}`}
              title={`Status: ${session.status}`}
            >
              {status}
            </span>
          )}
          <span className="truncate font-medium" title={title}>
            {title}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tabId);
            }}
            className={cn(
              'ml-auto flex-shrink-0 rounded p-0.5 hover:bg-accent cursor-pointer transition-opacity',
              isActive
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-40 group-hover:opacity-100 focus:opacity-100',
            )}
            aria-label={`Close tab ${title}`}
            title="Close tab"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenu>
    </Reorder.Item>
  );
});
