import { Reorder } from 'framer-motion';
import { Pencil, Plus, XCircle } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { ContextMenuItem } from '@/components/common/ContextMenu';
import { PromptDialog } from '@/components/common/PromptDialog';
import { useTerminalTabs } from '@/hooks/use-terminal-tabs';
import { handleTablistKeyDown } from '@/lib/roving-tabs';
import { getAllSessionIdsFromTree, getTabSession, useTerminalStore } from '@/stores/terminal-store';
import { SessionTab } from './SessionTab';

export function LocalTerminalTabs() {
  const {
    tabs: localTabs,
    layouts,
    activeTabId: activeLocalTabId,
    activate: handleActivateTab,
    reorder: handleReorder,
  } = useTerminalTabs('local');
  const closeTab = useTerminalStore((s) => s.closeTab);
  const renameTab = useTerminalStore((s) => s.renameTab);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

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
    useTerminalStore.getState().openLocalSession();
  }, []);

  const renamingSession = renamingTabId
    ? getTabSession(useTerminalStore.getState(), renamingTabId)
    : undefined;

  return (
    <div
      className="flex h-9 items-center border-b border-border/60 bg-card/60 no-select"
      role="tablist"
      aria-label="Local terminal tabs"
      onKeyDown={(e) => handleTablistKeyDown(e, handleActivateTab)}
    >
      <Reorder.Group
        transition={{ duration: 0 }}
        axis="x"
        values={localTabs}
        onReorder={handleReorder}
        className="flex items-center overflow-x-auto"
        as="div"
      >
        {localTabs.map((tabId, index) => {
          const root = layouts.get(tabId);
          if (!root) return null;
          return (
            <Tab
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeLocalTabId}
              tabbable={tabId === activeLocalTabId || (activeLocalTabId === null && index === 0)}
              onActivate={handleActivateTab}
              onClose={handleCloseTab}
              onRename={handleRename}
            />
          );
        })}
      </Reorder.Group>

      <button
        type="button"
        onClick={handleNewLocalTab}
        aria-label="New local terminal"
        className="flex size-9 items-center justify-center border-l border-border/40 text-muted-foreground hover:bg-background/50 hover:text-foreground transition-colors cursor-pointer"
        title="New Local Terminal"
      >
        <Plus className="size-4" />
      </button>

      <PromptDialog
        open={!!renamingTabId}
        title="Rename tab"
        placeholder="Tab name"
        defaultValue={renamingSession?.title || 'Local'}
        confirmLabel="Rename"
        onConfirm={(newTitle) => {
          if (renamingSession) renameTab(renamingSession.id, newTitle);
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
  /** The strip's single Tab stop (roving tabIndex). */
  tabbable: boolean;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string) => void;
}

const Tab = memo(function Tab({
  tabId,
  isActive,
  tabbable,
  onActivate,
  onClose,
  onRename,
}: TabProps) {
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

  return (
    <SessionTab
      tabId={tabId}
      isActive={isActive}
      tabbable={tabbable}
      contextItems={contextItems}
      onActivate={onActivate}
      onClose={onClose}
    />
  );
});
