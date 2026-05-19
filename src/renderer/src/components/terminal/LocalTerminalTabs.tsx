import { memo, useCallback, useMemo, useState } from 'react';
import { Pencil, X, XCircle, Monitor, Plus } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTerminalStore } from '@/stores/terminal-store';
import { PromptDialog } from '@/components/common/PromptDialog';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { v4 as uuidv4 } from 'uuid';

export function LocalTerminalTabs() {
  const {
    sessions,
    tabOrder,
    activeTabId,
    setActiveTab,
    setTabOrder,
    closeTab,
    renameTab,
    addSession,
  } = useTerminalStore();

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const localTabs = useMemo(
    () => tabOrder.filter((id) => sessions.get(id)?.type === 'local'),
    [tabOrder, sessions],
  );

  const handleCloseTab = useCallback(
    (sessionId: string) => {
      closeTab(sessionId);
    },
    [closeTab],
  );

  const handleRename = useCallback((sessionId: string) => {
    setRenamingTabId(sessionId);
  }, []);

  const handleNewLocalTab = useCallback(() => {
    const sessionId = uuidv4();
    addSession({
      id: sessionId,
      connectionId: 'local',
      connectionName: 'Local Terminal',
      status: 'connected',
      title: 'Local',
      type: 'local',
    });
    setActiveTab(sessionId);
  }, [addSession, setActiveTab]);

  const handleReorder = useCallback(
    (newOrder: string[]) => {
      const sshTabs = tabOrder.filter((id) => {
        const s = sessions.get(id);
        return !s || !s.type || s.type === 'ssh';
      });
      setTabOrder([...sshTabs, ...newOrder]);
    },
    [tabOrder, sessions, setTabOrder],
  );

  return (
    <div
      className="flex h-9 items-center border-b border-border/60 bg-card/60 no-select"
      role="tablist"
      aria-label="Local terminal tabs"
    >
      <Reorder.Group
        transition={{ duration: 0 }}
        axis="x"
        values={localTabs}
        onReorder={handleReorder}
        className="flex items-center overflow-x-auto"
        as="div"
      >
        {localTabs.map((sessionId) => {
          const session = sessions.get(sessionId);
          if (!session) return null;

          return (
            <Tab
              key={sessionId}
              sessionId={sessionId}
              isActive={sessionId === activeTabId}
              onActivate={setActiveTab}
              onClose={handleCloseTab}
              onRename={handleRename}
            />
          );
        })}
      </Reorder.Group>

      <button
        onClick={handleNewLocalTab}
        className="flex size-9 items-center justify-center border-l border-border/40 text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors cursor-pointer"
        title="New Local Terminal"
      >
        <Plus className="size-4" />
      </button>

      <PromptDialog
        open={!!renamingTabId}
        title="Rename tab"
        placeholder="Tab name"
        defaultValue={renamingTabId ? sessions.get(renamingTabId)?.title || 'Local' : ''}
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
  isActive: boolean;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
}

const Tab = memo(function Tab({ sessionId, isActive, onActivate, onClose, onRename }: TabProps) {
  const session = useTerminalStore((s) => s.sessions.get(sessionId));

  const contextItems: ContextMenuItem[] = useMemo(
    () => [
      {
        label: 'Rename Tab',
        icon: <Pencil className="size-3.5" />,
        onClick: () => onRename(sessionId),
      },
      {
        label: 'Close',
        icon: <XCircle className="size-3.5" />,
        onClick: () => onClose(sessionId),
        separator: true,
        destructive: true,
      },
    ],
    [sessionId, onRename, onClose],
  );

  if (!session) return null;

  return (
    <Reorder.Item
      initial={false}
      transition={{ duration: 0 }}
      value={sessionId}
      as="div"
      role="tab"
      aria-selected={isActive}
      className={cn(
        'group relative flex h-9 min-w-[90px] max-w-[200px] items-center gap-2 border-r border-border/40 px-3 text-xs cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
      )}
      whileDrag={{ opacity: 0.8, scale: 1.02, zIndex: 10 }}
      onClick={() => onActivate(sessionId)}
    >
      <ContextMenu items={contextItems}>
        <div className="flex h-full w-full items-center gap-2">
          {isActive && <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />}
          <Monitor
            className={cn('size-3', isActive ? 'text-primary' : 'text-muted-foreground/50')}
          />
          <span className="truncate font-medium">{session.title || 'Local'}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(sessionId);
            }}
            className={cn(
              'ml-auto flex-shrink-0 rounded p-0.5 hover:bg-accent cursor-pointer transition-opacity',
              isActive
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-40 group-hover:opacity-100 focus:opacity-100',
            )}
            aria-label="Close tab"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenu>
    </Reorder.Item>
  );
});
