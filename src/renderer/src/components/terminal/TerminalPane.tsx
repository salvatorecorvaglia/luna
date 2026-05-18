import { useEffect, useMemo, useRef } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useTerminalStore } from '@/stores/terminal-store';
import type { SessionStatus } from '@shared/types/terminal';
import { useTerminalSession, type TerminalTransport } from './use-terminal-session';
import { TerminalSearchBar } from './TerminalSearchBar';
import { sanitizeTerminalText } from '@/lib/terminal-output';
import { attachFocusTrap } from '@/lib/focus-trap';

interface TerminalPaneProps {
  sessionId: string;
  isActive?: boolean;
}

export function TerminalPane({ sessionId, isActive }: TerminalPaneProps) {
  const session = useTerminalStore((s) => s.sessions.get(sessionId));
  const status = session?.status;

  const transport = useMemo<TerminalTransport>(
    () => ({
      sendData: (p) => window.api.ssh.sendData(p),
      resize: (p) => window.api.ssh.resize(p),
      onData: (cb) => window.api.ssh.onData(cb),
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
    setSearchMatch,
    searchAddonRef,
    closeSearch,
    findNext,
    findPrevious,
  } = useTerminalSession({
    sessionId,
    isActive,
    transport,
    logTag: 'TerminalPane',
    initErrorMessage: 'Failed to initialize terminal — try reopening the tab.',
    onReady: ({ terminal }) => {
      const cleanupClose = window.api.ssh.onClose((event) => {
        if (event.sessionId === sessionId) {
          terminal.write('\r\n\x1b[31m--- Connection closed ---\x1b[0m\r\n');
        }
      });

      const cleanupError = window.api.ssh.onError((event) => {
        if (event.sessionId === sessionId) {
          terminal.write(
            `\r\n\x1b[31m--- Error: ${sanitizeTerminalText(event.error)} ---\x1b[0m\r\n`,
          );
        }
      });

      const { updateSessionStatus } = useTerminalStore.getState();
      const cleanupStatus = window.api.ssh.onStatus(
        (event: { sessionId: string; status: SessionStatus }) => {
          if (event.sessionId === sessionId) {
            updateSessionStatus(sessionId, event.status);
          }
        },
      );

      return () => {
        cleanupClose();
        cleanupError();
        cleanupStatus();
      };
    },
  });

  const overlayShown = status === 'error' || status === 'disconnected';
  const overlayRef = useRef<HTMLDivElement>(null);
  const reconnectBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!overlayShown || !overlayRef.current) return;
    // Move focus into the overlay so screen readers announce the dialog and
    // keyboard users land on the actionable button instead of staying on the
    // terminal underneath. attachFocusTrap also restores focus to the prior
    // element on unmount.
    reconnectBtnRef.current?.focus();
    return attachFocusTrap(overlayRef.current);
  }, [overlayShown]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {overlayShown && (
        <div
          ref={overlayRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`terminal-overlay-title-${sessionId}`}
          aria-describedby={`terminal-overlay-desc-${sessionId}`}
          className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border/80 bg-card p-6 shadow-2xl">
            <div className="text-center">
              <h3
                id={`terminal-overlay-title-${sessionId}`}
                className="text-lg font-medium text-foreground"
              >
                {status === 'error' ? 'Connection Error' : 'Disconnected'}
              </h3>
              <p
                id={`terminal-overlay-desc-${sessionId}`}
                className="mt-1 text-sm text-muted-foreground"
              >
                The SSH session to the server was lost.
              </p>
            </div>
            <button
              ref={reconnectBtnRef}
              onClick={() => {
                if (session?.connectionId) {
                  useTerminalStore.getState().updateSessionStatus(sessionId, 'connecting');
                  void window.api.ssh.connect({ connectionId: session.connectionId, sessionId });
                }
              }}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCcw className="h-4 w-4" />
              Reconnect
            </button>
          </div>
        </div>
      )}

      {searchOpen && (
        <TerminalSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          setQuery={setSearchQuery}
          match={searchMatch}
          setMatch={setSearchMatch}
          searchAddonRef={searchAddonRef}
          onFindNext={findNext}
          onFindPrevious={findPrevious}
          onClose={closeSearch}
        />
      )}
      <div
        ref={containerRef}
        role="application"
        aria-label={`Terminal session ${session?.title ?? sessionId}`}
        className="h-full w-full"
        style={{ padding: '4px' }}
      />
    </div>
  );
}
