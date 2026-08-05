import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';
import { TerminalSearchBar } from './TerminalSearchBar';
import { type TerminalTransport, useTerminalSession } from './use-terminal-session';

interface LocalTerminalPaneProps {
  sessionId: string;
  isActive?: boolean;
}

export function LocalTerminalPane({ sessionId, isActive }: LocalTerminalPaneProps) {
  const spawnedRef = useRef(false);

  const transport = useMemo<TerminalTransport>(
    () => ({
      sendData: (p) => getApi().localTerminal.sendData(p),
      resize: (p) => getApi().localTerminal.resize(p),
      onData: (cb) => getApi().localTerminal.onData(cb),
    }),
    [],
  );

  const {
    containerRef,
    searchInputRef,
    searchOpen,
    searchQuery,
    setSearchQuery,
    searchMatch,
    searchAddonRef,
    closeSearch,
    findNext,
    findPrevious,
  } = useTerminalSession({
    sessionId,
    isActive,
    transport,
    logTag: 'LocalTerminalPane',
    initErrorMessage: 'Failed to initialize local terminal.',
    onReady: ({ terminal }) => {
      if (!spawnedRef.current) {
        spawnedRef.current = true;
        getApi()
          .localTerminal.spawn({ sessionId, cols: terminal.cols, rows: terminal.rows })
          .catch((err: unknown) => {
            console.error('[LocalTerminalPane] spawn failed', err);
            toast.error('Failed to start local terminal.');
          });
      }

      const cleanupExit = getApi().localTerminal.onExit((event) => {
        if (event.sessionId === sessionId) {
          terminal.write(`\r\n\x1b[33m--- Shell exited (code ${event.exitCode}) ---\x1b[0m\r\n`);
          useTerminalStore.getState().updateSessionStatus(sessionId, 'disconnected');
        }
      });

      return () => {
        cleanupExit();
      };
    },
  });

  return (
    <div className="relative h-full w-full overflow-hidden">
      {searchOpen && (
        <TerminalSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          setQuery={setSearchQuery}
          match={searchMatch}
          searchAddonRef={searchAddonRef}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onClose={closeSearch}
          showMatchCount={false}
        />
      )}
      <div
        ref={containerRef}
        role="application"
        aria-label="Local terminal session"
        className="h-full w-full"
        style={{ padding: '4px' }}
      />
    </div>
  );
}
