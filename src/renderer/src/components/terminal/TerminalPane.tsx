import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ChevronDown, ChevronUp, RefreshCcw, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal-store';
import { terminalThemes } from '@/themes/terminal';
import { LIMITS } from '@shared/constants';
import type { SessionStatus } from '@shared/types/terminal';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform);

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
    // Debounce so a stream of ResizeObserver events during a window drag
    // doesn't fan out into a fit()/SSH-resize per frame.
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

    // Construct xterm + addons inside a try/catch so a thrower (typically
    // happens when running headless or when a node addon fails to load)
    // doesn't leave half-initialized state behind. On failure, dispose
    // anything that did get created and bail out of the effect.
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
      console.error('[TerminalPane] xterm initialization failed', err);
      toast.error('Failed to initialize terminal — try reopening the tab.');
      return;
    }

    // Try WebGL; on context loss dispose it and load the Canvas addon so we
    // don't drop all the way down to xterm's DOM renderer (which is much
    // slower). Notify the user once so a sudden loss isn't mysterious.
    try {
      const webglAddon = new WebglAddon();
      let webglNoticeShown = false;
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        try {
          terminal.loadAddon(new CanvasAddon());
        } catch {
          // DOM renderer is the last-resort fallback.
        }
        if (!webglNoticeShown) {
          webglNoticeShown = true;
          toast.warning('Terminal GPU acceleration was lost — switched to software rendering.', {
            id: `webgl-loss-${sessionId}`,
          });
        }
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL itself failed to initialize — try Canvas, then fall through to DOM.
      try {
        terminal.loadAddon(new CanvasAddon());
      } catch {
        // DOM renderer is the last-resort fallback.
      }
    }

    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Paste helper — warn before pasting multi-line content into a shell that
    // hasn't enabled bracketed-paste mode (newlines would execute commands).
    const pasteText = (text: string) => {
      if (!text) return;
      const bracketed = (terminal.modes as { bracketedPasteMode?: boolean })?.bracketedPasteMode;
      if (!bracketed && /\r|\n/.test(text)) {
        const ok = window.confirm(
          'The clipboard contains multiple lines. Pasting may execute commands. Continue?',
        );
        if (!ok) return;
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

    // Cross-platform keyboard shortcuts. Returning false suppresses xterm's
    // default handling. CRITICAL: never intercept plain Ctrl+C on
    // Linux/Windows — it must reach the remote shell as SIGINT.
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const meta = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Copy
      if (meta && (e.key === 'c' || e.key === 'C')) {
        if (copySelection()) {
          e.preventDefault();
          return false;
        }
        // No selection: on macOS Cmd+C is harmless; on Linux/Win this branch
        // is Ctrl+Shift+C, so still suppress to avoid any default action.
        if (!isMac) return false;
        return true;
      }
      // Paste
      if (meta && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        readClipboardAndPaste();
        return false;
      }
      // Find
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openSearch();
        return false;
      }
      // Clear
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        terminal.clear();
        return false;
      }
      // Zoom in (= or +)
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const { fontSize: cur, setFontSize } = useTerminalStore.getState();
        setFontSize(cur + 1);
        return false;
      }
      // Zoom out
      if (mod && e.key === '-') {
        e.preventDefault();
        const { fontSize: cur, setFontSize } = useTerminalStore.getState();
        setFontSize(cur - 1);
        return false;
      }
      // Zoom reset
      if (mod && e.key === '0') {
        e.preventDefault();
        useTerminalStore.getState().setFontSize(LIMITS.DEFAULT_FONT_SIZE);
        return false;
      }
      return true;
    });

    const xtermEl = containerRef.current;

    // Ctrl/Cmd + wheel → zoom. Throttled via requestAnimationFrame so a
    // fast scroll doesn't queue dozens of state updates.
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

    // Right-click → paste from clipboard (conventional on Windows/Linux,
    // and a useful affordance on macOS too).
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      readClipboardAndPaste();
    };
    xtermEl.addEventListener('contextmenu', onContextMenu);

    // Middle-click paste on Linux. The selection clipboard isn't directly
    // accessible via the Web Clipboard API, so this falls through to the
    // system clipboard — best-effort.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1 || !isLinux) return;
      e.preventDefault();
      readClipboardAndPaste();
    };
    xtermEl.addEventListener('mousedown', onMouseDown);

    // Drag & drop — paste shell-quoted file paths. Electron 32+ removed
    // File.path; we use text/uri-list (file:// URIs) which works across
    // versions and platforms.
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
              // Not a URL — fall through to use raw value.
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

    // ResizeObserver delivers an initial entry on .observe() once layout
    // is ready, which is what we want for the first fit — rely on that
    // instead of a setTimeout race against the paint cycle.
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      cleanupData();
      cleanupClose();
      cleanupError();
      cleanupStatus();
      observer.disconnect();
      xtermEl.removeEventListener('wheel', onWheel);
      xtermEl.removeEventListener('contextmenu', onContextMenu);
      xtermEl.removeEventListener('mousedown', onMouseDown);
      xtermEl.removeEventListener('dragover', onDragOver);
      xtermEl.removeEventListener('drop', onDrop);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, handleResize, openSearch]);

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

  // Re-fit and focus when tab becomes active. handleResize already debounces
  // through resizeTimeoutRef, so calling it directly is safe — the previous
  // setTimeout(50) wrapper was masking timing rather than fixing it.
  useEffect(() => {
    if (isActive) {
      handleResize();
      terminalRef.current?.focus();
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
