import { Reorder } from 'framer-motion';
import { ArrowRightToLine, Circle, Code, Copy, Filter, LayoutGrid, Loader2, Pencil, Radio, WifiOff, X, XCircle } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { PromptDialog } from '@/components/common/PromptDialog';
import { BroadcastInputBar } from '@/components/terminal/BroadcastInputBar';
import { MacroRecorderDialog } from '@/components/terminal/MacroRecorderDialog';
import { SnippetVaultDialog } from '@/components/terminal/SnippetVaultDialog';
import { TerminalFilterBar } from '@/components/terminal/TerminalFilterBar';
import { WorkspacePresetsDialog } from '@/components/terminal/WorkspacePresetsDialog';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import {
  getAllSessionIdsFromTree,
  getFirstLeafSessionId,
  hasSessionInTree,
  useTerminalStore,
} from '@/stores/terminal-store';

export function TerminalTabs() {
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
    layouts,
  } = useTerminalStore();
  const [closingTabId, setClosingTabId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  // Phase 2 & 3 dialog & toolbar state
  const [showSnippetVault, setShowSnippetVault] = useState(false);
  const [showBroadcastBar, setShowBroadcastBar] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [showMacroRecorder, setShowMacroRecorder] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);

  const sshTabs = useMemo(
    () =>
      tabOrder.filter((id) => {
        const s = sessions.get(id);

        return !s || !s.type || s.type === 'ssh';
      }),
    [tabOrder, sessions],
  );

  const activeSshTabId = useMemo(() => {
    if (!activeTabId) return null;
    for (const tabId of sshTabs) {
      const root = layouts.get(tabId);
      if (root && hasSessionInTree(root, activeTabId)) {
        return tabId;
      }
    }
    return null;
  }, [sshTabs, activeTabId, layouts]);

  const handleReorder = useCallback(
    (newOrder: string[]) => {
      const localTabs = tabOrder.filter((id) => sessions.get(id)?.type === 'local');
      setTabOrder([...newOrder, ...localTabs]);
    },
    [tabOrder, sessions, setTabOrder],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
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
    [sessions, layouts, closeTab],
  );

  const handleRename = useCallback((tabId: string) => {
    setRenamingTabId(tabId);
  }, []);

  const handleDuplicate = useCallback(
    (tabId: string) => {
      const session = sessions.get(tabId);
      if (!session) return;
      void connectToHost(session.connectionId);
    },
    [sessions],
  );

  const handleActivateTab = useCallback(
    (tabId: string) => {
      const root = layouts.get(tabId);
      if (root) {
        setActiveTab(getFirstLeafSessionId(root));
      } else {
        setActiveTab(tabId);
      }
    },
    [layouts, setActiveTab],
  );

  return (
    <div
      className="flex h-9 items-center border-b border-border/60 bg-card/60 no-select"
      role="tablist"
      aria-label="Terminal tabs (drag to reorder)"
    >
      <Reorder.Group
        transition={{ duration: 0 }}
        axis="x"
        values={sshTabs}
        onReorder={handleReorder}
        className="flex flex-1 items-center overflow-x-auto"
        as="div"
      >
        {sshTabs.map((tabId) => {
          const root = layouts.get(tabId);
          if (!root) return null;
          return (
            <Tab
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeSshTabId}
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

      {/* Toolbar actions for Snippets, Broadcast, Filter, Presets */}
      <div className="flex items-center gap-1 px-2 border-l border-border/40">
        <button
          onClick={() => setShowSnippetVault(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Snippet Vault & Scripts"
        >
          <Code className="size-3.5" />
        </button>

        <button
          onClick={() => setShowBroadcastBar((v) => !v)}
          className={cn(
            'rounded p-1 transition-colors cursor-pointer',
            showBroadcastBar
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          title="Broadcast Input to Multiple Terminals"
        >
          <Radio className="size-3.5" />
        </button>

        <button
          onClick={() => setShowFilterBar((v) => !v)}
          className={cn(
            'rounded p-1 transition-colors cursor-pointer',
            showFilterBar
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          title="Live Terminal Output Filter"
        >
          <Filter className="size-3.5" />
        </button>

        <button
          onClick={() => setShowMacroRecorder(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Terminal Macro Recorder"
        >
          <Circle className="size-3.5 text-destructive/80" />
        </button>

        <button
          onClick={() => setShowWorkspaces(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Workspace Layout Presets"
        >
          <LayoutGrid className="size-3.5" />
        </button>
      </div>

      <BroadcastInputBar open={showBroadcastBar} onClose={() => setShowBroadcastBar(false)} />
      <TerminalFilterBar open={showFilterBar} onClose={() => setShowFilterBar(false)} />

      <MacroRecorderDialog
        open={showMacroRecorder}
        onClose={() => setShowMacroRecorder(false)}
        onRunMacro={(sequence) => {
          if (activeTabId) {
            const session = sessions.get(activeTabId);
            for (const cmd of sequence) {
              if (session?.type === 'local') {
                window.api.localTerminal.sendData({ sessionId: activeTabId, data: `${cmd}\n` });
              } else {
                window.api.ssh.sendData({ sessionId: activeTabId, data: `${cmd}\n` });
              }
            }
          }
        }}
      />

      <SnippetVaultDialog
        open={showSnippetVault}
        onClose={() => setShowSnippetVault(false)}
        onRunSnippet={(command) => {
          if (activeTabId) {
            const session = sessions.get(activeTabId);
            if (session?.type === 'local') {
              window.api.localTerminal.sendData({ sessionId: activeTabId, data: `${command}\n` });
            } else {
              window.api.ssh.sendData({ sessionId: activeTabId, data: `${command}\n` });
            }
          }
        }}
      />

      <WorkspacePresetsDialog
        open={showWorkspaces}
        onClose={() => setShowWorkspaces(false)}
        onRestoreWorkspace={(preset) => {
          if (preset.layout.connectionIds && preset.layout.connectionIds.length > 0) {
            for (const connId of preset.layout.connectionIds) {
              connectToHost(connId);
            }
          }
        }}
      />

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
  tabId: string;
  isActive: boolean;
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
  onActivate,
  onClose,
  onRename,
  onDuplicate,
  onCloseOthers,
  onCloseToRight,
}: TabProps) {
  const session = useTerminalStore((s) => s.sessions.get(tabId));

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

  if (!session) return null;

  const statusIcon = () => {
    const label = `Status: ${session.status}`;
    const inner = (() => {
      switch (session.status) {
        case 'connected':
          return <div className="size-2 rounded-full bg-success" />;
        case 'connecting':
        case 'reconnecting':
          return <Loader2 className="size-3 text-warning animate-spin" />;
        case 'error':
          return <WifiOff className="size-3 text-destructive" />;
        default:
          return <div className="size-2 rounded-full bg-muted-foreground/30" />;
      }
    })();
    return (
      <span role="img" aria-label={label} title={label}>
        {inner}
      </span>
    );
  };

  return (
    <Reorder.Item
      initial={false}
      transition={{ duration: 0 }}
      value={tabId}
      as="div"
      role="tab"
      aria-selected={isActive}
      aria-label={session.title || session.connectionName}
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
          {statusIcon()}
          <span className="truncate font-medium" title={session.title || session.connectionName}>
            {session.title || session.connectionName}
          </span>

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
            aria-label={`Close tab ${session.title || session.connectionName}`}
            title="Close tab"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenu>
    </Reorder.Item>
  );
});
