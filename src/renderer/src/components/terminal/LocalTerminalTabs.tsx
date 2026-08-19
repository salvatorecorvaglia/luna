import { Reorder } from 'framer-motion';
import { Monitor, Pencil, Plus, X, XCircle } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { PromptDialog } from '@/components/common/PromptDialog';
import { cn } from '@/lib/utils';
import {
  getAllSessionIdsFromTree,
  getFirstLeafSessionId,
  hasSessionInTree,
  useActiveSessionId,
  useTerminalStore,
  useTerminalTabOrder,
} from '@/stores/terminal-store';

export function LocalTerminalTabs() {
  // Individual selectors instead of a whole-store destructure — see the same
  // change in TerminalTabs.tsx for why.
  const sessions = useTerminalStore((s) => s.sessions);
  const tabOrder = useTerminalTabOrder();
  const activeSessionId = useActiveSessionId();
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const setTabOrder = useTerminalStore((s) => s.setTabOrder);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const renameTab = useTerminalStore((s) => s.renameTab);
  const addSession = useTerminalStore((s) => s.addSession);
  const layouts = useTerminalStore((s) => s.layouts);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const localTabs = useMemo(
    () => tabOrder.filter((id) => sessions.get(id)?.type === 'local'),
    [tabOrder, sessions],
  );

  const activeLocalTabId = useMemo(() => {
    if (!activeSessionId) return null;
    for (const tabId of localTabs) {
      const root = layouts.get(tabId);
      if (root && hasSessionInTree(root, activeSessionId)) {
        return tabId;
      }
    }
    return null;
  }, [localTabs, activeSessionId, layouts]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const root = layouts.get(tabId);
      const ids = root ? getAllSessionIdsFromTree(root) : [tabId];
      for (const id of ids) {
        closeTab(id);
      }
    },
    [layouts, closeTab],
  );

  const handleRename = useCallback((tabId: string) => {
    setRenamingTabId(tabId);
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
    setActiveSession(sessionId);
  }, [addSession, setActiveSession]);

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

  const handleActivateTab = useCallback(
    (tabId: string) => {
      const root = layouts.get(tabId);
      if (root) {
        setActiveSession(getFirstLeafSessionId(root));
      } else {
        setActiveSession(tabId);
      }
    },
    [layouts, setActiveSession],
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
        {localTabs.map((tabId) => {
          const root = layouts.get(tabId);
          if (!root) return null;
          return (
            <Tab
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeLocalTabId}
              onActivate={handleActivateTab}
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
  tabId: string;
  isActive: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string) => void;
}

const Tab = memo(function Tab({ tabId, isActive, onActivate, onClose, onRename }: TabProps) {
  const session = useTerminalStore((s) => s.sessions.get(tabId));

  const contextItems: ContextMenuItem[] = useMemo(
    () => [
      {
        label: 'Rename Tab',
        icon: <Pencil className="size-3.5" />,
        onClick: () => onRename(tabId),
      },
      {
        label: 'Close',
        icon: <XCircle className="size-3.5" />,
        onClick: () => onClose(tabId),
        separator: true,
        destructive: true,
      },
    ],
    [tabId, onRename, onClose],
  );

  if (!session) return null;

  return (
    <Reorder.Item
      initial={false}
      transition={{ duration: 0 }}
      value={tabId}
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
      onClick={() => onActivate(tabId)}
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
              onClose(tabId);
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
