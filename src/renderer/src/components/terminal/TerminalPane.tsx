import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { ChevronDown, ChevronUp, RefreshCcw, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal-store';
import { terminalThemes } from '@/themes/terminal';
import type { SessionStatus } from '@shared/types/terminal';

interface TerminalPaneProps {
  sessionId: string;
  isActive?: boolean;
}

export function TerminalPane({ sessionId, isActive }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalTheme = useTerminalStore((s) => s.terminalTheme);
  const fontSize = useTerminalStore((s) => s.fontSize);
  const scrollback = useTerminalStore((s) => s.scrollback);
  const session = useTerminalStore((s) => s.sessions.get(sessionId));
  const status = session?.status;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (fitAddon && terminal) {
        try {
          fitAddon.fit();
          window.api.ssh.resize({
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch (err) {
          // Most often the terminal isn't attached yet (initial paint).
          // Log via warn so persistent failures are visible (CQ5).
          console.warn('[TerminalPane] resize failed', err);
        }
      }
    }, 100);
  }, [sessionId]);

  // Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, []);

  const findNext = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (!containerRef.current) return;

    const {
      terminalTheme: initialThemeName,
      fontSize: initialFontSize,
      scrollback: initialScrollback,
    } = useTerminalStore.getState();
    const theme = terminalThemes[initialThemeName];

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: initialFontSize,
      fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: initialScrollback,
      allowProposedApi: true,
      screenReaderMode: true,
      theme,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);

    terminal.open(containerRef.current);

    // Try WebGL, fall back to canvas. On context loss, dispose the addon
    // and let xterm fall back to its DOM/canvas renderer instead of going
    // black silently. Notify the user once so a sudden loss isn't mysterious.
    try {
      const webglAddon = new WebglAddon();
      let webglNoticeShown = false;
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        if (!webglNoticeShown) {
          webglNoticeShown = true;
          toast.warning('Terminal GPU acceleration was lost — switched to software rendering.', {
            id: `webgl-loss-${sessionId}`,
          });
        }
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // Canvas renderer is the default fallback when WebGL itself can't initialize.
    }

    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Send keystrokes to SSH
    terminal.onData((data) => {
      window.api.ssh.sendData({ sessionId, data });
    });

    // Receive data from SSH
    const cleanupData = window.api.ssh.onData((event) => {
      if (event.sessionId === sessionId) {
        terminal.write(event.data);
      }
    });

    // Handle close
    const cleanupClose = window.api.ssh.onClose((event) => {
      if (event.sessionId === sessionId) {
        terminal.write('\r\n\x1b[31m--- Connection closed ---\x1b[0m\r\n');
      }
    });

    // Handle error — strip control chars (incl. ESC) so server-side messages can't
    // smuggle ANSI sequences into the local terminal buffer.
    const sanitize = (s: string): string => {
      let out = '';
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        const printable = code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
        out += printable ? s[i] : '?';
      }
      return out;
    };
    const cleanupError = window.api.ssh.onError((event) => {
      if (event.sessionId === sessionId) {
        terminal.write(`\r\n\x1b[31m--- Error: ${sanitize(event.error)} ---\x1b[0m\r\n`);
      }
    });

    // Sync session status from main process
    const { updateSessionStatus } = useTerminalStore.getState();
    const cleanupStatus = window.api.ssh.onStatus(
      (event: { sessionId: string; status: SessionStatus }) => {
        if (event.sessionId === sessionId) {
          updateSessionStatus(sessionId, event.status);
        }
      },
    );

    // ResizeObserver for container size changes
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    // Initial resize
    setTimeout(() => {
      fitAddon.fit();
      window.api.ssh.resize({
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    }, 50);

    return () => {
      cleanupData();
      cleanupClose();
      cleanupError();
      cleanupStatus();
      observer.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, handleResize]);

  // Update theme in place without remounting (preserves scroll history).
  // Mutating `options.theme` doesn't trigger xterm's redraw — colors
  // stay stale until the next keystroke writes to the buffer. Force a
  // refresh of the visible viewport so the swap is immediate.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.theme = terminalThemes[terminalTheme];
      try {
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        // refresh can throw if the terminal isn't attached yet — harmless.
      }
    }
  }, [terminalTheme]);

  // Apply font size changes live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontSize = fontSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  // Apply scrollback changes live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.scrollback = scrollback;
      // Re-fit so the visible row count picks up the new buffer geometry.
      fitAddonRef.current?.fit();
    }
  }, [scrollback]);

  // Re-fit and focus when tab becomes active
  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        handleResize();
        terminalRef.current?.focus();
      }, 50);
    }
  }, [isActive, handleResize]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Disconnected Overlay */}
      {(status === 'error' || status === 'disconnected') && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border/80 bg-card p-6 shadow-2xl">
            <div className="text-center">
              <h3 className="text-lg font-medium text-foreground">
                {status === 'error' ? 'Connection Error' : 'Disconnected'}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The SSH session to the server was lost.
              </p>
            </div>
            <button
              onClick={() => {
                if (session?.connectionId) {
                  useTerminalStore.getState().updateSessionStatus(sessionId, 'connecting');
                  window.api.ssh.connect({ connectionId: session.connectionId, sessionId });
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

      {/* Search bar */}
      {searchOpen && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border/80 bg-card px-2 py-1 shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) {
                searchAddonRef.current?.findNext(e.target.value);
              } else {
                searchAddonRef.current?.clearDecorations();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) {
                  findPrevious();
                } else {
                  findNext();
                }
              }
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="Search..."
            aria-label="Search terminal output"
            className="w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={findPrevious}
            className="btn-icon !p-0.5"
            title="Previous"
            aria-label="Previous match"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={findNext}
            className="btn-icon !p-0.5"
            title="Next"
            aria-label="Next match"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={closeSearch}
            className="btn-icon !p-0.5"
            title="Close"
            aria-label="Close search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" style={{ padding: '4px' }} />
    </div>
  );
}
