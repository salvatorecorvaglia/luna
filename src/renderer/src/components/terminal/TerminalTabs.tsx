import { Reorder } from 'framer-motion';
import { ArrowRightToLine, Copy, Pencil, X, XCircle } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import type { ContextMenuItem } from '@/components/common/ContextMenu';
import { PromptDialog } from '@/components/common/PromptDialog';
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar';
import { useTerminalTabs } from '@/hooks/use-terminal-tabs';
import { handleTablistKeyDown } from '@/lib/roving-tabs';
import { openNewSession } from '@/lib/ssh';
import { getAllSessionIdsFromTree, getTabSession, useTerminalStore } from '@/stores/terminal-store';
import { SessionTab } from './SessionTab';

export function TerminalTabs() {
  const {
    tabs: sshTabs,
    layouts,
    activeTabId: activeSshTabId,
    activate: handleActivateTab,
    reorder: handleReorder,
  } = useTerminalTabs('ssh');
  const closeTab = useTerminalStore((s) => s.closeTab);
  const renameTab = useTerminalStore((s) => s.renameTab);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const closeOtherTabs = useTerminalStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useTerminalStore((s) => s.closeTabsToRight);
  const [closingTabId, setClosingTabId] = useState<string | null>(null);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const { sessions, layouts } = useTerminalStore.getState();
      const root = layouts.get(tabId);
      const ids = root ? getAllSessionIdsFromTree(root) : [tabId];
      const hasActive = ids.some((id) => {
        const s = sessions.get(id);
        return s && (s.status === 'connected' || s.status === 'connecting');
      });

      if (hasActive) {
        setClosingTabId(tabId);
      } else {
        for (const id of ids) {
          closeTab(id);
        }
      }
    },
    [closeTab],
  );

  const handleRename = useCallback((tabId: string) => {
    setRenamingTabId(tabId);
  }, []);

  const handleDuplicate = useCallback((tabId: string) => {
    const session = getTabSession(useTerminalStore.getState(), tabId);
    if (!session) return;
    // openNewSession, not connectToHost: the latter focuses an existing
    // connected session for the connection — which, for a tab you just
    // right-clicked, is always this one. Duplicate then did nothing.
    void openNewSession(session.connectionId);
  }, []);

  const renamingSession = renamingTabId
    ? getTabSession(useTerminalStore.getState(), renamingTabId)
    : undefined;

  return (
    <div
      className="flex h-9 items-center border-b border-border/60 bg-card/60 no-select"
      role="tablist"
      aria-label="Terminal tabs (drag to reorder)"
      onKeyDown={(e) => handleTablistKeyDown(e, handleActivateTab)}
    >
      <Reorder.Group
        transition={{ duration: 0 }}
        axis="x"
        values={sshTabs}
        onReorder={handleReorder}
        className="flex flex-1 items-center overflow-x-auto"
        as="div"
      >
        {sshTabs.map((tabId, index) => {
          const root = layouts.get(tabId);
          if (!root) return null;
          return (
            <Tab
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeSshTabId}
              tabbable={tabId === activeSshTabId || (activeSshTabId === null && index === 0)}
              onActivate={handleActivateTab}
              onClose={handleCloseTab}
              onRename={handleRename}
              onDuplicate={handleDuplicate}
              onCloseOthers={closeOtherTabs}
              onCloseToRight={closeTabsToRight}
            />
          );
        })}
      </Reorder.Group>

      <TerminalToolbar />

      <ConfirmDialog
        open={!!closingTabId}
        title="Close active tab?"
        message="This will disconnect all terminal sessions in this tab. Are you sure?"
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          if (closingTabId) {
            const root = layouts.get(closingTabId);
            const ids = root ? getAllSessionIdsFromTree(root) : [closingTabId];
            for (const id of ids) {
              closeTab(id);
            }
          }
          setClosingTabId(null);
        }}
        onCancel={() => setClosingTabId(null)}
      />

      <PromptDialog
        open={!!renamingTabId}
        title="Rename tab"
        placeholder="Tab name"
        defaultValue={renamingSession?.title || renamingSession?.connectionName || ''}
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
  onDuplicate: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
}

const Tab = memo(function Tab({
  tabId,
  isActive,
  tabbable,
  onActivate,
  onClose,
  onRename,
  onDuplicate,
  onCloseOthers,
  onCloseToRight,
}: TabProps) {
  const contextItems: ContextMenuItem[] = useMemo(
    () => [
      {
        label: 'Rename Tab',
        icon: <Pencil className="size-3.5" />,
        onClick: () => onRename(tabId),
      },
      {
        label: 'Duplicate Session',
        icon: <Copy className="size-3.5" />,
        onClick: () => onDuplicate(tabId),
      },
      {
        label: 'Close Other Tabs',
        icon: <XCircle className="size-3.5" />,
        onClick: () => onCloseOthers(tabId),
        separator: true,
      },
      {
        label: 'Close Tabs to the Right',
        icon: <ArrowRightToLine className="size-3.5" />,
        onClick: () => onCloseToRight(tabId),
      },
      {
        label: 'Close',
        icon: <X className="size-3.5" />,
        onClick: () => onClose(tabId),
        separator: true,
        destructive: true,
      },
    ],
    [tabId, onRename, onDuplicate, onCloseOthers, onCloseToRight, onClose],
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
