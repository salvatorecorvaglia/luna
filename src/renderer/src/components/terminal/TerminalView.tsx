import { Plus, Terminal as TerminalIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { connectToHost } from '@/lib/ssh';
import { useConnectionStore } from '@/stores/connection-store';
import { useTerminalStore, hasSessionInTree } from '@/stores/terminal-store';
import type { PaneNode } from '@shared/types/terminal';
import { terminalThemes } from '@/themes/terminal';
import { TerminalTabs } from './TerminalTabs';
import { SplitLayout } from './SplitLayout';

export { connectToHost };

export function TerminalView() {
  const { sessions, tabOrder, activeTabId, terminalTheme, layouts } = useTerminalStore();

  const sshTabs = tabOrder.filter((id) => {
    const s = sessions.get(id);

    return !s || !s.type || s.type === 'ssh';
  });

  const activeSshTabId = useMemo(() => {
    if (!activeTabId) return sshTabs[0] || null;
    if (sshTabs.includes(activeTabId)) return activeTabId;
    for (const tabId of sshTabs) {
      const root = layouts.get(tabId);
      if (root && hasSessionInTree(root, activeTabId)) {
        return tabId;
      }
    }
    return sshTabs[0] || null;
  }, [sshTabs, activeTabId, layouts]);

  const handleNewTab = useCallback(() => {
    const { activeConnectionId } = useConnectionStore.getState();
    if (activeConnectionId) {
      void connectToHost(activeConnectionId);
    } else {
      useConnectionStore.getState().openCreateForm();
    }
  }, []);

  // Keyboard shortcuts: Cmd+1..9 for tab switching, Cmd+Shift+]/[ for next/prev, Cmd+W close tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      const { sessions, tabOrder, setActiveTab, activeTabId, closeTab, layouts } =
        useTerminalStore.getState();
      const sshTabs = tabOrder.filter((id) => {
        const s = sessions.get(id);

        return !s || !s.type || s.type === 'ssh';
      });
      if (sshTabs.length === 0) return;

      // Cmd+W — delegate to closeTab (TerminalTabs owns the confirm dialog)
      if (e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        if (!activeTabId) return;
        closeTab(activeTabId);
        return;
      }

      // Cmd+1 through Cmd+9
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        e.preventDefault();
        const index = Math.min(digit - 1, sshTabs.length - 1);
        const tabId = sshTabs[index];
        // Focus the first leaf in that tab's layout tree
        const root = layouts.get(tabId);
        if (root) {
          const firstLeafId = getFirstLeafIdFromRoot(root);
          setActiveTab(firstLeafId);
        } else {
          setActiveTab(tabId);
        }
        return;
      }

      // Cmd+Shift+] — next tab
      if (e.shiftKey && e.key === ']') {
        e.preventDefault();
        const currentTabId = sshTabs.find(tabId => {
          const root = layouts.get(tabId);
          return root && hasSessionInTree(root, activeTabId ?? '');
        }) ?? sshTabs[0];
        const idx = sshTabs.indexOf(currentTabId ?? '');
        const nextTabId = sshTabs[(idx + 1) % sshTabs.length];
        const root = layouts.get(nextTabId);
        if (root) {
          setActiveTab(getFirstLeafIdFromRoot(root));
        }
        return;
      }

      // Cmd+Shift+[ — previous tab
      if (e.shiftKey && e.key === '[') {
        e.preventDefault();
        const currentTabId = sshTabs.find(tabId => {
          const root = layouts.get(tabId);
          return root && hasSessionInTree(root, activeTabId ?? '');
        }) ?? sshTabs[0];
        const idx = sshTabs.indexOf(currentTabId ?? '');
        const prevTabId = sshTabs[(idx - 1 + sshTabs.length) % sshTabs.length];
        const root = layouts.get(prevTabId);
        if (root) {
          setActiveTab(getFirstLeafIdFromRoot(root));
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function getFirstLeafIdFromRoot(node: PaneNode): string {
    if (node.type === 'terminal') return node.sessionId;
    return getFirstLeafIdFromRoot(node.children[0]);
  }

  const themeBg = terminalThemes[terminalTheme]?.background || '#282a36';

  return (
    <div className="flex h-full flex-col">
      <TerminalTabs />
      <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: themeBg }}>
        {sshTabs.map((tabId) => {
          const rootNode = layouts.get(tabId);
          if (!rootNode) return null;
          return (
            <div
              key={tabId}
              className={tabId === activeSshTabId ? 'h-full w-full' : 'hidden'}
            >
              <SplitLayout
                node={rootNode}
                tabId={tabId}
                activeSessionId={activeTabId}
              />
            </div>
          );
        })}

        {sshTabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
              <TerminalIcon className="size-7 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">No active sessions</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Select a connection from the sidebar to begin
              </p>
            </div>

            <button onClick={handleNewTab} className="btn-outline mt-1">
              <Plus className="size-3.5" />
              New Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
