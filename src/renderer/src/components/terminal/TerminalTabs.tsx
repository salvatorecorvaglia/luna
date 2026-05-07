import { memo, useCallback, useMemo, useState } from 'react';
import { ArrowRightToLine, Copy, Loader2, Pencil, Plus, WifiOff, X, XCircle } from 'lucide-react';
import { motion, Reorder } from 'framer-motion';
import { cn } from '@/lib/utils';
import { type TerminalSession, useTerminalStore } from '@/stores/terminal-store';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PromptDialog } from '@/components/common/PromptDialog';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { connectToHost } from '@/lib/ssh';

interface TerminalTabsProps {
  onNewTab: () => void;
}

export function TerminalTabs({ onNewTab }: TerminalTabsProps) {
  const {
    sessions,
    tabOrder,
    activeTabId,
    setActiveTab,
    setTabOrder,
    closeTab,
    renameTab,
    closeOtherTabs,
    closeTabsToRight,
  } = useTerminalStore();
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const handleCloseTab = useCallback(
    (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session && (session.status === 'connected' || session.status === 'connecting')) {
        setClosingTabId(sessionId);
      } else {
        closeTab(sessionId);
      }
    },
    [sessions, closeTab],
  );

  const handleRename = useCallback((sessionId: string) => {
    setRenamingTabId(sessionId);
  }, []);

  const handleDuplicate = useCallback(
    (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (!session) return;
      connectToHost(session.connectionId);
    },
    [sessions],
  );

  return (
    <div
      className="flex h-9 items-center border-b border-border/60 bg-card/60 no-select"
      role="tablist"
      aria-label="Terminal tabs (drag to reorder)"
    >
      <Reorder.Group
        axis="x"
        values={tabOrder}
        onReorder={setTabOrder}
        className="flex flex-1 items-center overflow-x-auto"
        as="div"
      >
        {tabOrder.map((sessionId) => {
          const session = sessions.get(sessionId);
          if (!session) return null;

          return (
            <Tab
              key={sessionId}
              sessionId={sessionId}
              session={session}
              isActive={sessionId === activeTabId}
              onActivate={setActiveTab}
              onClose={handleCloseTab}
              onRename={handleRename}
              onDuplicate={handleDuplicate}
              onCloseOthers={closeOtherTabs}
              onCloseToRight={closeTabsToRight}
            />
          );
        })}
      </Reorder.Group>
      <button
        onClick={onNewTab}
        className="btn-icon mx-1 !p-1.5 flex-shrink-0"
        title="New tab"
        aria-label="New tab"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <ConfirmDialog
        open={!!closingTabId}
        title="Close active session?"
        message="This will disconnect the SSH session. Are you sure?"
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          if (closingTabId) closeTab(closingTabId);
          setClosingTabId(null);
        }}
        onCancel={() => setClosingTabId(null)}
      />

      <PromptDialog
        open={!!renamingTabId}
        title="Rename tab"
        placeholder="Tab name"
        defaultValue={
          renamingTabId
            ? sessions.get(renamingTabId)?.title ||
              sessions.get(renamingTabId)?.connectionName ||
              ''
            : ''
        }
        confirmLabel="Rename"
        onConfirm={(newTitle) => {
          if (renamingTabId) renameTab(renamingTabId, newTitle);
          setRenamingTabId(null);
        }}
        onCancel={() => setRenamingTabId(null)}
      />
    </div>
  );
}

interface TabProps {
  sessionId: string;
  session: TerminalSession;
  isActive: boolean;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
  onDuplicate: (sessionId: string) => void;
  onCloseOthers: (sessionId: string) => void;
  onCloseToRight: (sessionId: string) => void;
}

const Tab = memo(function Tab({
  sessionId,
  session,
  isActive,
  onActivate,
  onClose,
  onRename,
  onDuplicate,
  onCloseOthers,
  onCloseToRight,
}: TabProps) {
  const statusIcon = () => {
    switch (session.status) {
      case 'connected':
        return <div className="h-2 w-2 rounded-full bg-emerald-500" />;
      case 'connecting':
      case 'reconnecting':
        return <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />;
      case 'error':
        return <WifiOff className="h-3 w-3 text-destructive" />;
      default:
        return <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />;
    }
  };

  const contextItems: ContextMenuItem[] = useMemo(
    () => [
      {
        label: 'Rename Tab',
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: () => onRename(sessionId),
      },
      {
        label: 'Duplicate Session',
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: () => onDuplicate(sessionId),
      },
      {
        label: 'Close Other Tabs',
        icon: <XCircle className="h-3.5 w-3.5" />,
        onClick: () => onCloseOthers(sessionId),
        separator: true,
      },
      {
        label: 'Close Tabs to the Right',
        icon: <ArrowRightToLine className="h-3.5 w-3.5" />,
        onClick: () => onCloseToRight(sessionId),
      },
      {
        label: 'Close',
        icon: <X className="h-3.5 w-3.5" />,
        onClick: () => onClose(sessionId),
        separator: true,
        destructive: true,
      },
    ],
    [sessionId, onRename, onDuplicate, onCloseOthers, onCloseToRight, onClose],
  );

  return (
    <Reorder.Item
      value={sessionId}
      as="div"
      role="tab"
      aria-selected={isActive}
      aria-label={session.title || session.connectionName}
      className={cn(
        'group relative flex h-9 min-w-[120px] max-w-[200px] items-center gap-2 border-r border-border/40 px-3 text-xs cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
      )}
      whileDrag={{ opacity: 0.8, scale: 1.02, zIndex: 10 }}
      onClick={() => onActivate(sessionId)}
    >
      <ContextMenu items={contextItems}>
        <div className="flex h-full w-full items-center gap-2">
          {isActive && (
            <motion.div
              layoutId="active-tab-indicator"
              className="absolute inset-x-0 top-0 h-[2px] bg-primary"
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            />
          )}
          {statusIcon()}
          <span
            className="truncate font-medium"
            title={session.title || session.connectionName}
          >
            {session.title || session.connectionName}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(sessionId);
            }}
            className={cn(
              'ml-auto flex-shrink-0 rounded p-0.5 hover:bg-accent cursor-pointer transition-opacity',
              // Visible at low opacity by default so the close affordance is
              // always discoverable; full opacity on hover/focus.
              isActive
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-40 group-hover:opacity-100 focus:opacity-100',
            )}
            aria-label={`Close tab ${session.title || session.connectionName}`}
            title="Close tab"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </ContextMenu>
    </Reorder.Item>
  );
});
