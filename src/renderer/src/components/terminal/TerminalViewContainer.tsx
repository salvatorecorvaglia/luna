import type { PaneNode } from '@shared/types/terminal';
import { Monitor, Plus, Terminal as TerminalIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { openNewSession } from '@/lib/ssh';
import { useConnectionStore } from '@/stores/connection-store';
import {
  hasSessionInTree,
  useActiveSessionId,
  useTerminalStore,
  useTerminalTabOrder,
  useTerminalTheme,
} from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';
import { terminalThemes } from '@/themes/terminal';
import { LocalTerminalTabs } from './LocalTerminalTabs';
import { SplitLayout } from './SplitLayout';
import { TerminalTabs } from './TerminalTabs';

interface TerminalViewContainerProps {
  type: 'ssh' | 'local';
}

function getFirstLeafIdFromRoot(node: PaneNode): string {
  if (node.type === 'terminal') return node.sessionId;
  return getFirstLeafIdFromRoot(node.children[0]);
}

export function TerminalViewContainer({ type }: TerminalViewContainerProps) {
  // Individual selectors instead of a whole-store destructure: the previous
  // no-selector `useTerminalStore()` re-rendered this component — and every
  // mounted tab's SplitLayout tree beneath it — on every single store
  // change, including fields this component never reads (fontSize, etc.).
  const sessions = useTerminalStore((s) => s.sessions);
  const tabOrder = useTerminalTabOrder();
  const activeSessionId = useActiveSessionId();
  const terminalTheme = useTerminalTheme();
  const layouts = useTerminalStore((s) => s.layouts);
  const addSession = useTerminalStore((s) => s.addSession);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);

  const filteredTabs = useMemo(() => {
    return tabOrder.filter((id) => {
      const s = sessions.get(id);
      if (type === 'local') return s?.type === 'local';
      return !s || !s.type || s.type === 'ssh';
    });
  }, [tabOrder, sessions, type]);

  const activeFilteredTabId = useMemo(() => {
    if (!activeSessionId) return filteredTabs[0] || null;
    if (filteredTabs.includes(activeSessionId)) return activeSessionId;
    for (const tabId of filteredTabs) {
      const root = layouts.get(tabId);
      if (root && hasSessionInTree(root, activeSessionId)) {
        return tabId;
      }
    }
    return filteredTabs[0] || null;
  }, [filteredTabs, activeSessionId, layouts]);

  const handleNewTab = useCallback(() => {
    if (type === 'local') {
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
    } else {
      const { activeConnectionId } = useConnectionStore.getState();
      if (activeConnectionId) {
        // "New Tab"/"New Session" must always create. connectToHost would just
        // re-focus the already-connected tab and look like a dead button.
        void openNewSession(activeConnectionId);
      } else {
        useConnectionStore.getState().openCreateForm();
      }
    }
  }, [type, addSession, setActiveSession]);

  const autoSpawnRef = useRef(false);

  // Auto-spawn local tab if none exist (for local mode only)
  useEffect(() => {
    if (type === 'local') {
      if (filteredTabs.length === 0 && !autoSpawnRef.current) {
        autoSpawnRef.current = true;
        handleNewTab();
      } else if (filteredTabs.length > 0) {
        autoSpawnRef.current = false;
      }
    }
  }, [type, filteredTabs.length, handleNewTab]);

  // Keyboard shortcuts: Cmd+1..9 for tab switching, Cmd+W close tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      // Both the SSH and Local containers stay mounted once visited (App keeps
      // them in the DOM, hidden), so both have this listener attached. Without
      // this gate, Cmd+2 in the SSH view also activated the hidden Local view's
      // 2nd tab — whichever listener ran last won, silently moving the active
      // session out of the view the user is looking at. Cmd+W was already
      // guarded by its `modeTabs` membership check below; the digit branch was
      // not.
      const activeView = useUIStore.getState().activeView;
      if (type === 'local' ? activeView !== 'local' : activeView !== 'terminal') return;

      const { sessions, tabOrder, setActiveSession, activeSessionId, closeTab, layouts } =
        useTerminalStore.getState();
      const modeTabs = tabOrder.filter((id) => {
        const s = sessions.get(id);
        if (type === 'local') return s?.type === 'local';
        return !s || !s.type || s.type === 'ssh';
      });
      if (modeTabs.length === 0) return;

      // Cmd+W
      if (e.key === 'w' && !e.shiftKey) {
        if (
          activeSessionId &&
          modeTabs.some((tabId) => {
            const root = layouts.get(tabId);
            return root && hasSessionInTree(root, activeSessionId);
          })
        ) {
          e.preventDefault();
          closeTab(activeSessionId);
          return;
        }
      }

      // Cmd+T — new tab. Advertised in ShortcutsHelp and the command palette
      // but never actually implemented, so the badge was a lie.
      if (e.code === 'KeyT' && !e.shiftKey) {
        e.preventDefault();
        handleNewTab();
        return;
      }

      // Cmd+Shift+] / Cmd+Shift+[ — next / previous tab. Also advertised in two
      // places without a handler behind them.
      //
      // Matched on `e.code`, not `e.key`: with Shift held, `key` is '}' / '{'
      // on a US layout and something else entirely elsewhere. App.tsx uses
      // `e.code` for its view chords for the same reason.
      if (e.shiftKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault();
        const currentTab = modeTabs.findIndex((tabId) => {
          const root = layouts.get(tabId);
          return activeSessionId && root && hasSessionInTree(root, activeSessionId);
        });
        if (currentTab === -1) return;
        const delta = e.code === 'BracketRight' ? 1 : -1;
        // Wrap, so the shortcut is usable as a cycle rather than dead-ending.
        const nextTab = (currentTab + delta + modeTabs.length) % modeTabs.length;
        // Non-null: index is taken modulo a non-empty array.
        const tabId = modeTabs[nextTab]!;
        const root = layouts.get(tabId);
        setActiveSession(root ? getFirstLeafIdFromRoot(root) : tabId);
        return;
      }

      // Cmd+1 through Cmd+9
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        e.preventDefault();
        const index = Math.min(digit - 1, modeTabs.length - 1);
        // Non-null: the `modeTabs.length === 0` guard above ensures index is
        // always within [0, modeTabs.length - 1].
        const tabId = modeTabs[index]!;
        const root = layouts.get(tabId);
        if (root) {
          const firstLeafId = getFirstLeafIdFromRoot(root);
          setActiveSession(firstLeafId);
        } else {
          setActiveSession(tabId);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [type, handleNewTab]);

  const themeBg = terminalThemes[terminalTheme]?.background || '#282a36';

  return (
    <div className="flex h-full flex-col">
      {type === 'ssh' ? <TerminalTabs /> : <LocalTerminalTabs />}
      <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: themeBg }}>
        {filteredTabs.map((tabId) => {
          const rootNode = layouts.get(tabId);
          if (!rootNode) return null;
          return (
            <div key={tabId} className={tabId === activeFilteredTabId ? 'h-full w-full' : 'hidden'}>
              <SplitLayout node={rootNode} tabId={tabId} activeSessionId={activeSessionId} />
            </div>
          );
        })}

        {filteredTabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
              {type === 'ssh' ? (
                <TerminalIcon className="size-7 text-muted-foreground/30" />
              ) : (
                <Monitor className="size-7 text-muted-foreground/30" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">
                {type === 'ssh' ? 'No active sessions' : 'No active local sessions'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                {type === 'ssh'
                  ? 'Select a connection from the sidebar to begin'
                  : 'Open a local terminal to run commands on your machine'}
              </p>
            </div>

            <button type="button" onClick={handleNewTab} className="btn-outline mt-1">
              <Plus className="size-3.5" />
              {type === 'ssh' ? 'New Session' : 'New Local Terminal'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
