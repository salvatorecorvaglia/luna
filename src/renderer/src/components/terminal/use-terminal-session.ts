import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal-store';
import { logger } from '@/lib/logger';
import { terminalThemes } from '@/themes/terminal';
import { buildTerminalKeyHandler, installXtermPointerHandlers } from '@/lib/terminal-input';

export interface TerminalTransport {
  /** Send keystrokes to the underlying transport (SSH stream / local PTY). */
  sendData(payload: { sessionId: string; data: string }): unknown;
  /** Forward terminal cols/rows after a fit so the remote side can match geometry. */
  resize(payload: { sessionId: string; cols: number; rows: number }): unknown;
  /** Subscribe to incoming data frames. Returns an unsubscribe. */
  onData(cb: (event: { sessionId: string; data: string }) => void): () => void;
}

export interface TerminalSessionOptions {
  sessionId: string;
  isActive?: boolean;
  transport: TerminalTransport;
  /** Log/console tag used in error paths. */
  logTag: string;
  /** Toast surfaced when xterm construction throws. */
  initErrorMessage: string;
  /**
   * Hook into the post-init lifecycle — runs after the terminal is mounted and
   * the data pump is wired. Use it to attach transport-specific subscriptions
   * (e.g. SSH close/error/status, local-PTY exit) or to spawn a backing process.
   * Return a cleanup; it runs alongside the rest of the teardown.
   */
  onReady?(ctx: { sessionId: string; terminal: Terminal }): (() => void) | void;
}

export interface TerminalSessionApi {
  containerRef: React.RefObject<HTMLDivElement>;
  searchInputRef: React.RefObject<HTMLInputElement>;
  searchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** -1 sentinel index means "no search active"; total=0 means "no match". */
  searchMatch: { index: number; total: number } | null;
  setSearchMatch: (m: { index: number; total: number } | null) => void;
  openSearch(): void;
  closeSearch(): void;
  findNext(): void;
  findPrevious(): void;
  searchAddonRef: React.RefObject<SearchAddon>;
  /** Imperative handle to the underlying xterm instance, if needed. */
  terminalRef: React.RefObject<Terminal>;
}

/**
 * Shared xterm.js session lifecycle: construction, addon loading, WebGL→Canvas→DOM
 * fallback, debounced resize, theme/font/scrollback live-update, and search UI
 * state. Consumers supply a transport (send/resize/onData) plus an optional
 * onReady to wire their distinct subscriptions.
 */
export function useTerminalSession(opts: TerminalSessionOptions): TerminalSessionApi {
  const { sessionId, isActive, transport, logTag, initErrorMessage, onReady } = opts;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const terminalTheme = useTerminalStore((s) => s.terminalTheme);
  const fontSize = useTerminalStore((s) => s.fontSize);
  const scrollback = useTerminalStore((s) => s.scrollback);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatch, setSearchMatch] = useState<{ index: number; total: number } | null>(null);

  // Track activeness through a ref so a debounced resize re-checks it at fire
  // time — otherwise a queued resize could dispatch for a tab the user already
  // switched away from.
  const isActiveRef = useRef<boolean>(isActive ?? true);
  useEffect(() => {
    isActiveRef.current = isActive ?? true;
  }, [isActive]);

  // onReady is a callback supplied by the consumer; we don't want a transport
  // identity change to retrigger the heavy init effect, so route it through a
  // ref and read the latest value inside the effect.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const transportRef = useRef(transport);
  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  const handleResize = useCallback(() => {
    // Debounce so a stream of ResizeObserver events during a window drag
    // doesn't fan out into a fit()/resize per frame.
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(() => {
      resizeTimeoutRef.current = null;
      if (!isActiveRef.current) return;
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      // `terminal.element` is set once the terminal has been opened into the
      // DOM and a renderer is wired up — public-API replacement for an older
      // `(terminal as any)._core._renderService` probe.
      if (fitAddon && terminal && terminal.element) {
        try {
          fitAddon.fit();
          void transportRef.current.resize({
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch (err) {
          logger.warn(`[${logTag}] resize failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }, 100);
  }, [sessionId, logTag]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    queueMicrotask(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchMatch(null);
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

      // Construct xterm + addons inside a try/catch so a thrower (typically a
      // headless env or a failed native addon) doesn't leave half-initialized
      // state behind.
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

        searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
          setSearchMatch({ index: resultIndex, total: resultCount });
        });

        // Important: open the terminal before loading fitAddon or doing any layout.
        terminal.open(containerRef.current);
        terminal.loadAddon(fitAddon);
      } catch (err) {
        console.error(`[${logTag}] xterm initialization failed`, err);
        toast.error(initErrorMessage);
        return;
      }

      // WebGL → Canvas → DOM fallback ladder. On WebGL context loss, swap to
      // Canvas so we don't drop all the way down to xterm's much slower DOM
      // renderer. Notify once per session so a sudden loss isn't mysterious.
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
        try {
          terminal.loadAddon(new CanvasAddon());
        } catch {
          // DOM fallback
        }
      }

      try {
        fitAddon.fit();
      } catch (err) {
        logger.debug(`[${logTag}] Initial fit failed`, { error: err });
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      terminal.attachCustomKeyEventHandler(buildTerminalKeyHandler(terminal, openSearch));

      const xtermEl = containerRef.current;
      const teardownPointer = installXtermPointerHandlers(terminal, xtermEl);

      // Forward keystrokes
      terminal.onData((data) => {
        void transportRef.current.sendData({ sessionId, data });
      });

      // Receive frames from transport
      const cleanupData = transportRef.current.onData((event) => {
        if (event.sessionId === sessionId) {
          terminal.write(event.data);
        }
      });

      // Consumer-supplied subscriptions (e.g. SSH close/error/status, local exit)
      const readyCleanup = onReadyRef.current?.({ sessionId, terminal }) ?? undefined;

      // ResizeObserver delivers an initial entry on .observe() once layout is
      // ready, which is what we want for the first fit — rely on that instead
      // of a setTimeout race against the paint cycle.
      const observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);

      cleanup = () => {
        cleanupData();
        if (typeof readyCleanup === 'function') readyCleanup();
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
  }, [sessionId, handleResize, openSearch, logTag, initErrorMessage]);

  // Live theme swap. Mutating options.theme doesn't trigger xterm's redraw —
  // colors stay stale until the next keystroke writes to the buffer. Force a
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

  // Apply font size + scrollback together. fit() is expensive (forces reflow +
  // xterm dimension recalc); merging avoids two fits when both change in one
  // render (e.g. loading a saved profile).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    terminal.options.scrollback = scrollback;
    try {
      fitAddonRef.current?.fit();
    } catch {
      /* ignore — fit can throw if the terminal isn't attached yet */
    }
  }, [fontSize, scrollback]);

  // Re-fit and focus when the tab becomes active. handleResize already
  // debounces, so calling it directly is safe.
  useEffect(() => {
    if (isActive) {
      handleResize();
      terminalRef.current?.focus();
    } else if (resizeTimeoutRef.current) {
      // Pane went inactive while a debounced resize was queued — drop it
      // so it can't dispatch resize for the wrong session.
      clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = null;
    }
  }, [isActive, handleResize]);

  return {
    containerRef,
    searchInputRef,
    searchOpen,
    searchQuery,
    setSearchQuery,
    searchMatch,
    setSearchMatch,
    openSearch,
    closeSearch,
    findNext,
    findPrevious,
    searchAddonRef,
    terminalRef,
  };
}
