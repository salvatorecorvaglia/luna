import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import '@xterm/xterm/css/xterm.css';
import { logger } from '@/lib/logger';
import { buildTerminalKeyHandler, installXtermPointerHandlers } from '@/lib/terminal-input';
import { openTerminalLink } from '@/lib/terminal-links';
import { registerTerminal, unregisterTerminal } from '@/lib/terminal-registry';
import { SEARCH_STEP_OPTIONS } from '@/lib/terminal-search';
import { useTerminalStore } from '@/stores/terminal-store';
import { terminalThemes } from '@/themes/terminal';

export interface TerminalTransport {
  /** Send keystrokes to the underlying transport (SSH stream / local PTY). */
  sendData(payload: { sessionId: string; data: string }): unknown;
  /** Forward terminal cols/rows after a fit so the remote side can match geometry. */
  resize(payload: { sessionId: string; cols: number; rows: number }): unknown;
  /** Subscribe to incoming data frames. Returns an unsubscribe. */
  onData(cb: (event: { sessionId: string; data: string }) => void): () => void;
  /**
   * Report output xterm has finished parsing, so main can apply backpressure
   * (main/lib/output-flow.ts). Optional: a transport without it gets no flow
   * control, never a stalled source.
   */
  ack?(payload: { sessionId: string; chars: number; reset?: boolean }): unknown;
}

/** Acknowledge parsed output in batches this large, not per frame. */
const ACK_BATCH_CHARS = 64 * 1024;

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
  containerRef: React.RefObject<HTMLDivElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
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
  searchAddonRef: React.RefObject<SearchAddon | null>;
  /** Imperative handle to the underlying xterm instance, if needed. */
  terminalRef: React.RefObject<Terminal | null>;
}

/**
 * Live xterm instances, keyed by session id, that outlive the component that
 * displays them.
 *
 * Splitting a pane moves the existing terminal one level deeper in the
 * SplitLayout tree, and closing one side of a split moves the survivor up. React
 * remounts across a depth change, and the old lifecycle disposed the xterm on
 * unmount — so every split/unsplit wiped the surviving pane's scrollback (SSH)
 * or left it blank with no prompt (local, whose PTY spawn is idempotent).
 *
 * Instead the terminal is opened into a detached `host` element that is moved
 * between containers. Unmount schedules disposal one macrotask out; a remount in
 * the same commit — which is what a split is — reclaims it before that fires.
 * A session that is really gone has no remount, so it is disposed on schedule.
 */
interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  host: HTMLDivElement;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const liveTerminals = new Map<string, CachedTerminal>();

function releaseTerminal(sessionId: string, cached: CachedTerminal): void {
  cached.host.remove();
  if (cached.disposeTimer) clearTimeout(cached.disposeTimer);
  cached.disposeTimer = setTimeout(() => {
    if (liveTerminals.get(sessionId) !== cached) return;
    liveTerminals.delete(sessionId);
    unregisterTerminal(sessionId);
    try {
      cached.terminal.dispose();
    } catch {
      // Already torn down.
    }
  }, 0);
}

/** Test-only: dispose every cached terminal immediately. */
export function __disposeAllTerminals(): void {
  for (const [sessionId, cached] of liveTerminals) {
    if (cached.disposeTimer) clearTimeout(cached.disposeTimer);
    unregisterTerminal(sessionId);
    cached.terminal.dispose();
  }
  liveTerminals.clear();
}

/**
 * Shared xterm.js session lifecycle: construction, addon loading, WebGL→DOM
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
  const screenReaderMode = useTerminalStore((s) => s.screenReaderMode);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatch, setSearchMatch] = useState<{ index: number; total: number } | null>(null);

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
      // Not gated on isActive: every *visible* pane of a split must refit when
      // the window or divider moves, or the unfocused one keeps a stale
      // geometry until clicked. Hidden panes (other tabs/views) measure 0x0 and
      // are skipped by the size check below.
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;
      // `terminal.element` is set once the terminal has been opened into the
      // DOM and a renderer is wired up — public-API replacement for an older
      // `(terminal as any)._core._renderService` probe.

      if (fitAddon && terminal && terminal.element) {
        // Skip a zero-size element.
        //
        // Views stay mounted and are hidden with `display: none` (App.tsx), and
        // `isActive` tracks the active *pane*, not view visibility — so the
        // active pane of a hidden view still reaches this. fit() then measures a
        // 0x0 box, derives a nonsense geometry, and we send that to the remote
        // as a window-size change. Chromium also reports 0x0 mid-layout.
        const { offsetWidth, offsetHeight } = terminal.element;
        if (offsetWidth === 0 || offsetHeight === 0) return;

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
    // setState schedules a render; the search input is conditionally mounted,
    // so the ref isn't populated until after the next commit+paint.
    // requestAnimationFrame fires after layout, by which point the input
    // exists and can take focus. queueMicrotask used to race the commit and
    // silently miss.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchMatch(null);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, []);

  const findNext = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findNext(searchQuery, SEARCH_STEP_OPTIONS);
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery, SEARCH_STEP_OPTIONS);
  }, [searchQuery]);

  /**
   * Construct xterm + addons into a fresh host element inside `container`.
   * Returns null (after telling the user) if construction throws — typically a
   * headless env or a failed native addon — so no half-initialised terminal is
   * cached.
   */
  const createTerminal = useCallback(
    (container: HTMLElement): CachedTerminal | null => {
      const {
        terminalTheme: initialThemeName,
        fontSize: initialFontSize,
        scrollback: initialScrollback,
        screenReaderMode: initialScreenReaderMode,
      } = useTerminalStore.getState();
      const theme = terminalThemes[initialThemeName];

      const host = document.createElement('div');
      host.style.width = '100%';
      host.style.height = '100%';
      container.appendChild(host);

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
          screenReaderMode: initialScreenReaderMode,
          theme,
          // OSC 8 hyperlinks. xterm's default handler confirm()s and then
          // window.open()s, which main denies — route them like plain links.
          linkHandler: { activate: openTerminalLink, allowNonHttpProtocols: false },
        });

        fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon(openTerminalLink);
        searchAddon = new SearchAddon();
        const unicode11Addon = new Unicode11Addon();

        terminal.loadAddon(webLinksAddon);
        terminal.loadAddon(searchAddon);
        terminal.loadAddon(unicode11Addon);
        terminal.unicode.activeVersion = '11';

        // Important: open the terminal before loading fitAddon or doing any layout.
        terminal.open(host);
        terminal.loadAddon(fitAddon);
      } catch (err) {
        host.remove();
        console.error(`[${logTag}] xterm initialization failed`, err);
        toast.error(initErrorMessage);
        return null;
      }

      // WebGL, falling back to xterm's built-in DOM renderer. There is no
      // canvas step any more: @xterm/addon-canvas never shipped a stable
      // release for xterm 6 (the installed 0.7 targets xterm 5), so loading it
      // failed silently inside the try/catch and the "Canvas" rung was already
      // the DOM renderer in practice. Notify once per session on context loss
      // so a sudden slowdown isn't mysterious.
      try {
        const webglAddon = new WebglAddon();
        let webglNoticeShown = false;
        webglAddon.onContextLoss(() => {
          // Disposing the addon hands rendering back to the DOM renderer.
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
        // No WebGL: the DOM renderer is already active.
      }

      return { terminal, fitAddon, searchAddon, host, disposeTimer: null };
    },
    [sessionId, logTag, initErrorMessage],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    queueMicrotask(() => {
      if (cancelled || !containerRef.current) return;
      const container = containerRef.current;

      let cached = liveTerminals.get(sessionId);
      if (cached) {
        // Remount (split/unsplit): reclaim the live terminal before its
        // scheduled disposal fires, and move it into the new container.
        if (cached.disposeTimer) {
          clearTimeout(cached.disposeTimer);
          cached.disposeTimer = null;
        }
        container.appendChild(cached.host);
      } else {
        const created = createTerminal(container);
        if (!created) return;
        cached = created;
        liveTerminals.set(sessionId, cached);
        // Makes the scrollback reachable from outside this pane (audit export).
        registerTerminal(sessionId, cached.terminal);
      }
      const entry = cached;
      const { terminal, fitAddon, searchAddon } = entry;

      try {
        fitAddon.fit();
      } catch (err) {
        logger.debug(`[${logTag}] Initial fit failed`, { error: err });
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      // Everything below is per mount: it closes over this component's state
      // setters and transport, so it is torn down on unmount and re-wired on
      // the next mount even though the terminal itself survives.
      const resultsSub = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        setSearchMatch({ index: resultIndex, total: resultCount });
      });

      terminal.attachCustomKeyEventHandler(buildTerminalKeyHandler(terminal, openSearch));

      const teardownPointer = installXtermPointerHandlers(terminal, container);

      // Forward keystrokes
      const keySub = terminal.onData((data) => {
        void transportRef.current.sendData({ sessionId, data });
      });

      // Receive frames from transport. The write callback fires once xterm
      // has parsed the chunk — that, not arrival, is what gets acknowledged,
      // so main slows the source when the parser falls behind.
      let unacked = 0;
      const ack = (payload: { sessionId: string; chars: number; reset?: boolean }): void => {
        const result = transportRef.current.ack?.(payload);
        if (result instanceof Promise) result.catch(() => {});
      };
      const cleanupData = transportRef.current.onData((event) => {
        if (event.sessionId !== sessionId) return;
        const chars = event.data.length;
        terminal.write(event.data, () => {
          unacked += chars;
          if (unacked >= ACK_BATCH_CHARS) {
            ack({ sessionId, chars: unacked });
            unacked = 0;
          }
        });
      });
      // A newly attached terminal owns no outstanding output: anything sent
      // while nothing was listening (e.g. across a reload) will never be
      // acknowledged, and would otherwise hold the source paused.
      ack({ sessionId, chars: 0, reset: true });

      // Consumer-supplied subscriptions (e.g. SSH close/error/status, local exit)
      const readyCleanup = onReadyRef.current?.({ sessionId, terminal }) ?? undefined;

      // ResizeObserver delivers an initial entry on .observe() once layout is
      // ready, which is what we want for the first fit — rely on that instead
      // of a setTimeout race against the paint cycle.
      const observer = new ResizeObserver(handleResize);
      observer.observe(container);

      cleanup = () => {
        cleanupData();
        keySub.dispose();
        resultsSub.dispose();
        if (typeof readyCleanup === 'function') readyCleanup();
        observer.disconnect();
        teardownPointer();
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
          // Null it too: the isActive effect below reads this ref to decide
          // whether a debounce is already pending, and a cleared-but-stale
          // handle made it look armed when nothing was scheduled.
          resizeTimeoutRef.current = null;
        }
        releaseTerminal(sessionId, entry);
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sessionId, handleResize, openSearch, logTag, createTerminal]);

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

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.screenReaderMode = screenReaderMode;
  }, [screenReaderMode]);

  // Apply font size + scrollback together. fit() is expensive (forces reflow +
  // xterm dimension recalc); merging avoids two fits when both change in one
  // render (e.g. loading a saved profile).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    terminal.options.scrollback = scrollback;
    // Through handleResize rather than a bare fit(): a font-size change alters
    // cols/rows without resizing the container, so the ResizeObserver never
    // fires and vim/htop on the remote kept rendering at the old geometry.
    handleResize();
  }, [fontSize, scrollback, handleResize]);

  // Re-fit and focus when the tab becomes active. handleResize already
  // debounces, so calling it directly is safe.
  useEffect(() => {
    if (isActive) {
      handleResize();
      terminalRef.current?.focus();
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
