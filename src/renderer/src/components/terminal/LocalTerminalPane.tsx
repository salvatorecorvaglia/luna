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
import { terminalThemes } from '@/themes/terminal';
import { LIMITS } from '@shared/constants';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform);

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

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      if (fitAddon && terminal) {
        try {
          fitAddon.fit();
          window.api.localTerminal.resize({
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch (err) {
          console.warn('[LocalTerminalPane] resize failed', err);
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

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = '11';
      terminal.open(containerRef.current);
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

    fitAddon.fit();
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

    // Paste helpers
    const pasteText = (text: string) => {
      if (!text) return;
      const bracketed = (terminal.modes as { bracketedPasteMode?: boolean })?.bracketedPasteMode;
      if (!bracketed && /\r|\n/.test(text)) {
        toast.warning('Clipboard contains multiple lines — pasting may execute commands.', {
          action: {
            label: 'Paste anyway',
            onClick: () => terminal.paste(text),
          },
        });
        return;
      }
      terminal.paste(text);
    };

    const copySelection = () => {
      if (!terminal.hasSelection()) return false;
      const sel = terminal.getSelection();
      if (!sel) return false;
      void navigator.clipboard.writeText(sel).catch(() => {
        toast.error('Failed to copy to clipboard.');
      });
      terminal.clearSelection();
      return true;
    };

    const readClipboardAndPaste = () => {
      navigator.clipboard
        .readText()
        .then((text) => pasteText(text))
        .catch(() => toast.error('Failed to read from clipboard.'));
    };

    // Keyboard shortcuts
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const meta = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (meta && (e.key === 'c' || e.key === 'C')) {
        if (copySelection()) {
          e.preventDefault();
          return false;
        }
        if (!isMac) return false;
        return true;
      }
      if (meta && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        readClipboardAndPaste();
        return false;
      }
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSearch();
        return false;
      }
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        terminal.clear();
        return false;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const { fontSize: cur, setFontSize } = useTerminalStore.getState();
        setFontSize(cur + 1);
        return false;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        const { fontSize: cur, setFontSize } = useTerminalStore.getState();
        setFontSize(cur - 1);
        return false;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        useTerminalStore.getState().setFontSize(LIMITS.DEFAULT_FONT_SIZE);
        return false;
      }
      return true;
    });

    const xtermEl = containerRef.current;

    // Wheel zoom
    let wheelPending = false;
    let wheelDelta = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      wheelDelta += e.deltaY;
      if (wheelPending) return;
      wheelPending = true;
      requestAnimationFrame(() => {
        wheelPending = false;
        const step = -Math.sign(wheelDelta);
        wheelDelta = 0;
        if (step === 0) return;
        const { fontSize: cur, setFontSize } = useTerminalStore.getState();
        setFontSize(cur + step);
      });
    };
    xtermEl.addEventListener('wheel', onWheel, { passive: false });

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      readClipboardAndPaste();
    };
    xtermEl.addEventListener('contextmenu', onContextMenu);

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1 || !isLinux) return;
      e.preventDefault();
      readClipboardAndPaste();
    };
    xtermEl.addEventListener('mousedown', onMouseDown);

    // Drag & drop
    const onDragOver = (e: DragEvent) => {
      if (
        e.dataTransfer?.types.includes('Files') ||
        e.dataTransfer?.types.includes('text/uri-list')
      ) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      e.preventDefault();
      const uriList = dt.getData('text/uri-list');
      if (uriList) {
        const paths = uriList
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#'))
          .map((uri) => {
            try {
              const u = new URL(uri);
              if (u.protocol === 'file:') return decodeURIComponent(u.pathname);
            } catch {
              // Not a URL
            }
            return uri;
          });
        if (paths.length > 0) {
          const quoted = paths.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
          pasteText(quoted);
          return;
        }
      }
      const text = dt.getData('text/plain');
      if (text) pasteText(text);
    };
    xtermEl.addEventListener('dragover', onDragOver);
    xtermEl.addEventListener('drop', onDrop);

    // Send keystrokes to local PTY
    terminal.onData((data) => {
      window.api.localTerminal.sendData({ sessionId, data });
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

    return () => {
      cleanupData();
      cleanupExit();
      observer.disconnect();
      xtermEl.removeEventListener('wheel', onWheel);
      xtermEl.removeEventListener('contextmenu', onContextMenu);
      xtermEl.removeEventListener('mousedown', onMouseDown);
      xtermEl.removeEventListener('dragover', onDragOver);
      xtermEl.removeEventListener('drop', onDrop);
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
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
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  // Scrollback live
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.scrollback = scrollback;
      fitAddonRef.current?.fit();
    }
  }, [scrollback]);

  // Re-fit and focus on active
  useEffect(() => {
    if (isActive) {
      handleResize();
      terminalRef.current?.focus();
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
