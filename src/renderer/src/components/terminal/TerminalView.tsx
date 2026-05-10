import { useCallback, useEffect } from 'react';
import { Plus, Terminal as TerminalIcon } from 'lucide-react';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnectionStore } from '@/stores/connection-store';
import { terminalThemes } from '@/themes/terminal';
import { connectToHost } from '@/lib/ssh';
import { TerminalTabs } from './TerminalTabs';
import { TerminalPane } from './TerminalPane';

export { connectToHost };

export function TerminalView() {
  const { sessions, tabOrder, activeTabId, terminalTheme } = useTerminalStore();

  const sshTabs = tabOrder.filter((id) => {
    const s = sessions.get(id);
    return !s || !s.type || s.type === 'ssh';
  });
  const activeSshTabId = sshTabs.includes(activeTabId || '') ? activeTabId : sshTabs[0] || null;

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

      const { sessions, tabOrder, setActiveTab, activeTabId, closeTab } =
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
        setActiveTab(sshTabs[index]);
        return;
      }

      // Cmd+Shift+] — next tab
      if (e.shiftKey && e.key === ']') {
        e.preventDefault();
        const idx = sshTabs.indexOf(activeTabId ?? '');
        const next = (idx + 1) % sshTabs.length;
        setActiveTab(sshTabs[next]);
        return;
      }

      // Cmd+Shift+[ — previous tab
      if (e.shiftKey && e.key === '[') {
        e.preventDefault();
        const idx = sshTabs.indexOf(activeTabId ?? '');
        const prev = (idx - 1 + sshTabs.length) % sshTabs.length;
        setActiveTab(sshTabs[prev]);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const themeBg = terminalThemes[terminalTheme]?.background || '#282a36';

  return (
    <div className="flex h-full flex-col">
      <TerminalTabs />
      <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: themeBg }}>
        {sshTabs.map((sessionId) => (
          <div
            key={sessionId}
            className={sessionId === activeSshTabId ? 'h-full w-full' : 'hidden'}
          >
            <TerminalPane sessionId={sessionId} isActive={sessionId === activeSshTabId} />
          </div>
        ))}

        {sshTabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <TerminalIcon className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground/60">No active sessions</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Select a connection from the sidebar to begin
              </p>
            </div>
            <button onClick={handleNewTab} className="btn-outline mt-1">
              <Plus className="h-3.5 w-3.5" />
              New Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
