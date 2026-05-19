import { useCallback, useEffect, useRef } from 'react';
import { Plus, Monitor } from 'lucide-react';
import { useTerminalStore } from '@/stores/terminal-store';
import { terminalThemes } from '@/themes/terminal';
import { LocalTerminalPane } from './LocalTerminalPane';
import { v4 as uuidv4 } from 'uuid';
import { LocalTerminalTabs } from './LocalTerminalTabs';

export function LocalTerminalView() {
  const { sessions, tabOrder, activeTabId, terminalTheme, addSession, setActiveTab } =
    useTerminalStore();

  const localTabs = tabOrder.filter((id) => sessions.get(id)?.type === 'local');
  const activeLocalTabId = localTabs.includes(activeTabId || '')
    ? activeTabId
    : localTabs[0] || null;

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

  const autoSpawnRef = useRef(false);

  // Auto-open first local tab if none exist
  useEffect(() => {
    if (localTabs.length === 0 && !autoSpawnRef.current) {
      autoSpawnRef.current = true;
      handleNewLocalTab();
    } else if (localTabs.length > 0) {
      autoSpawnRef.current = false;
    }
  }, [localTabs.length, handleNewLocalTab]);

  // Keyboard shortcuts: Cmd+1..9 for tab switching (within local tabs)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      const { sessions, tabOrder, setActiveTab, activeTabId, closeTab } =
        useTerminalStore.getState();
      const localTabs = tabOrder.filter((id) => sessions.get(id)?.type === 'local');
      if (localTabs.length === 0) return;

      // Cmd+W
      if (e.key === 'w' && !e.shiftKey) {
        if (activeTabId && localTabs.includes(activeTabId)) {
          e.preventDefault();
          closeTab(activeTabId);
          return;
        }
      }

      // Cmd+1 through Cmd+9
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        e.preventDefault();
        const index = Math.min(digit - 1, localTabs.length - 1);
        setActiveTab(localTabs[index]);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const themeBg = terminalThemes[terminalTheme]?.background || '#282a36';

  return (
    <div className="flex h-full flex-col">
      <LocalTerminalTabs />
      <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: themeBg }}>
        {localTabs.map((sessionId) => (
          <div
            key={sessionId}
            className={sessionId === activeLocalTabId ? 'h-full w-full' : 'hidden'}
          >
            <LocalTerminalPane sessionId={sessionId} isActive={sessionId === activeLocalTabId} />
          </div>
        ))}

        {localTabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
              <Monitor className="size-7 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">No active local sessions</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Open a local terminal to run commands on your machine
              </p>
            </div>
            <button onClick={handleNewLocalTab} className="btn-outline mt-1">
              <Plus className="size-3.5" />
              New Local Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
