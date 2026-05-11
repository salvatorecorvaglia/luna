import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal-store';
import { logger } from '@/lib/logger';
import { terminalThemes } from '@/themes/terminal';
import { buildTerminalKeyHandler, installXtermPointerHandlers } from '@/lib/terminal-input';

interface LocalTerminalPaneProps {
  sessionId: string;
  isActive?: boolean;
}

export function LocalTerminalPane({ sessionId, isActive }: LocalTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const spawnedRef = useRef(false);
  const terminalTheme = useTerminalStore((s) => s.terminalTheme);
  const fontSize = useTerminalStore((s) => s.fontSize);
  const scrollback = useTerminalStore((s) => s.scrollback);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isActiveRef = useRef<boolean>(isActive ?? true);
  useEffect(() => {
    isActiveRef.current = isActive ?? true;
  }, [isActive]);

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
      resizeTimeoutRef.current = null;
      if (!isActiveRef.current) return;
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      // `terminal.element` indicates the terminal has been opened into the
      // DOM and a renderer is wired up — public-API replacement for an older
      // `(terminal as any)._core._renderService` probe.
      if (fitAddon && terminal && terminal.element) {
        try {
          fitAddon.fit();
          void window.api.localTerminal.resize({
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch (err) {
          logger.warn('[LocalTerminalPane] resize failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }, 100);
  }, [sessionId]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    queueMicrotask(() => searchInputRef.current?.focus());
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

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    queueMicrotask(() => {
      if (cancelled || !containerRef.current) return;

      const {
        terminalTheme: initialThemeName,
        fontSize: initialFontSize,
        scrollback: initialScrollback,
      } = useTerminalStore.getState();
      const theme = terminalThemes[initialThemeName];

      let terminal: Terminal;
      let fitAddon: FitAddon;
      let searchAddon: SearchAddon;
      try {
        terminal = new Terminal({
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

        fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        searchAddon = new SearchAddon();
        const unicode11Addon = new Unicode11Addon();

        terminal.loadAddon(webLinksAddon);
        terminal.loadAddon(searchAddon);
        terminal.loadAddon(unicode11Addon);
        terminal.unicode.activeVersion = '11';

        // Important: open the terminal before loading fitAddon or doing any layout.
        terminal.open(containerRef.current);
        terminal.loadAddon(fitAddon);
      } catch (err) {
        console.error('[LocalTerminalPane] xterm initialization failed', err);
        toast.error('Failed to initialize local terminal.');
        return;
      }

      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          try {
            terminal.loadAddon(new CanvasAddon());
          } catch {
            // DOM fallback
          }
        });
        terminal.loadAddon(webglAddon);
      } catch {
        try {
          terminal.loadAddon(new CanvasAddon());
        } catch {
          // DOM fallback
        }
      }

      try {
        fitAddon.fit();
      } catch (err) {
        // Best-effort fit on initial mount. If it fails (e.g. terminal hidden),
        // it will be retried when the tab becomes active or resized.
        logger.debug('[LocalTerminalPane] Initial fit failed', { error: err });
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      // Spawn the PTY in main
      if (!spawnedRef.current) {
        spawnedRef.current = true;
        window.api.localTerminal
          .spawn({ sessionId, cols: terminal.cols, rows: terminal.rows })
          .catch((err: unknown) => {
            console.error('[LocalTerminalPane] spawn failed', err);
            toast.error('Failed to start local terminal.');
          });
      }

      terminal.attachCustomKeyEventHandler(buildTerminalKeyHandler(terminal, openSearch));

      const xtermEl = containerRef.current;
      const teardownPointer = installXtermPointerHandlers(terminal, xtermEl);

      // Send keystrokes to local PTY
      terminal.onData((data) => {
        void window.api.localTerminal.sendData({ sessionId, data });
      });

      // Receive data from local PTY
      const cleanupData = window.api.localTerminal.onData((event) => {
        if (event.sessionId === sessionId) {
          terminal.write(event.data);
        }
      });

      // Handle PTY exit
      const cleanupExit = window.api.localTerminal.onExit((event) => {
        if (event.sessionId === sessionId) {
          terminal.write(`\r\n\x1b[33m--- Shell exited (code ${event.exitCode}) ---\x1b[0m\r\n`);
          useTerminalStore.getState().updateSessionStatus(sessionId, 'disconnected');
        }
      });

      const observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);

      cleanup = () => {
        cleanupData();
        cleanupExit();
        observer.disconnect();
        teardownPointer();
        if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sessionId, handleResize, openSearch]);

  // Update theme live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.theme = terminalThemes[terminalTheme];
      try {
        terminal.refresh(0, terminal.rows - 1);
      } catch {
        // not attached yet
      }
    }
  }, [terminalTheme]);

  // Font size live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontSize = fontSize;
      try {
        fitAddonRef.current?.fit();
      } catch {
        /* ignore */
      }
    }
  }, [fontSize]);

  // Scrollback live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.scrollback = scrollback;
      try {
        fitAddonRef.current?.fit();
      } catch {
        /* ignore */
      }
    }
  }, [scrollback]);

  // Re-fit and focus on active
  useEffect(() => {
    if (isActive) {
      handleResize();
      terminalRef.current?.focus();
    } else if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = null;
    }
  }, [isActive, handleResize]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Search bar */}
      {searchOpen && (
        <div
          role="region"
          aria-label="Terminal search"
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border/80 bg-card px-2 py-1 shadow-lg"
        >
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
                if (e.shiftKey) findPrevious();
                else findNext();
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
      <div
        ref={containerRef}
        role="application"
        aria-label={`Local terminal session`}
        className="h-full w-full"
        style={{ padding: '4px' }}
      />
    </div>
  );
}
