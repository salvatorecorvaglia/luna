// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xterm/xterm', async () => {
  const { FakeTerminal } = await import('../../../../src/test/fake-xterm');
  return { Terminal: FakeTerminal };
});
vi.mock('@xterm/addon-fit', async () => {
  const { FakeFitAddon } = await import('../../../../src/test/fake-xterm');
  return { FitAddon: FakeFitAddon };
});
vi.mock('@xterm/addon-search', async () => {
  const { FakeSearchAddon } = await import('../../../../src/test/fake-xterm');
  return { SearchAddon: FakeSearchAddon };
});
vi.mock('@xterm/addon-webgl', async () => {
  const { FakeWebglAddon } = await import('../../../../src/test/fake-xterm');
  return { WebglAddon: FakeWebglAddon };
});
vi.mock('@xterm/addon-unicode11', async () => {
  const { FakeUnicode11Addon } = await import('../../../../src/test/fake-xterm');
  return { Unicode11Addon: FakeUnicode11Addon };
});
vi.mock('@xterm/addon-web-links', async () => {
  const { FakeWebLinksAddon } = await import('../../../../src/test/fake-xterm');
  return { WebLinksAddon: FakeWebLinksAddon };
});
vi.mock('@/lib/terminal-input', () => ({
  buildTerminalKeyHandler: () => () => false,
  installXtermPointerHandlers: () => () => {},
}));

const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}));

import type {
  TerminalSessionOptions,
  TerminalTransport,
} from '../../../../src/renderer/src/components/terminal/use-terminal-session';
import {
  __disposeAllTerminals,
  useTerminalSession,
} from '../../../../src/renderer/src/components/terminal/use-terminal-session';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import {
  FakeFitAddon,
  FakeSearchAddon,
  FakeTerminal,
  FakeWebglAddon,
  resetFakeXterm,
} from '../../../../src/test/fake-xterm';

function createMockTransport() {
  const handlers: Array<(e: { sessionId: string; data: string }) => void> = [];
  return {
    sendData: vi.fn(),
    resize: vi.fn(),
    ack: vi.fn(),
    onData: vi.fn((cb: (e: { sessionId: string; data: string }) => void) => {
      handlers.push(cb);
      return () => {
        const i = handlers.indexOf(cb);
        if (i >= 0) handlers.splice(i, 1);
      };
    }),
    emit(event: { sessionId: string; data: string }) {
      for (const cb of [...handlers]) cb(event);
    },
    listenerCount() {
      return handlers.length;
    },
  } satisfies TerminalTransport & {
    emit: (e: { sessionId: string; data: string }) => void;
    listenerCount: () => number;
  };
}

let lastApi: ReturnType<typeof useTerminalSession> | null = null;

function Harness(
  opts: Omit<TerminalSessionOptions, 'sessionId' | 'transport'> & {
    sessionId?: string;
    transport: TerminalTransport;
  },
) {
  const api = useTerminalSession({
    sessionId: opts.sessionId ?? 'sess-1',
    isActive: opts.isActive,
    transport: opts.transport,
    logTag: opts.logTag,
    initErrorMessage: opts.initErrorMessage,
    onReady: opts.onReady,
  });
  lastApi = api;
  return (
    <div>
      <div ref={api.containerRef} data-testid="container" />
      <input ref={api.searchInputRef} data-testid="search-input" />
    </div>
  );
}

beforeEach(() => {
  // Cached terminals outlive unmount by one macrotask (see liveTerminals);
  // drop them so each test constructs its own.
  __disposeAllTerminals();
  resetFakeXterm();
  toastError.mockClear();
  toastWarning.mockClear();
  lastApi = null;
  useTerminalStore.setState({
    terminalTheme: 'dracula',
    fontSize: 14,
    scrollback: 10000,
  });
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderHarness(
  transport: ReturnType<typeof createMockTransport>,
  overrides: Partial<Omit<TerminalSessionOptions, 'sessionId' | 'transport'>> = {},
) {
  return render(
    <Harness transport={transport} logTag="Test" initErrorMessage="init failed" {...overrides} />,
  );
}

describe('useTerminalSession — construction', () => {
  it('opens a terminal into the container and loads the addon stack', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    const terminal = FakeTerminal.last();
    expect(terminal.open).toHaveBeenCalledTimes(1);
    expect(terminal.element).not.toBeNull();
    expect(terminal.loadAddon).toHaveBeenCalled();
    expect(FakeFitAddon.instances).toHaveLength(1);
    expect(FakeSearchAddon.instances).toHaveLength(1);
  });

  it('shows a toast and does not throw when xterm construction fails', async () => {
    FakeTerminal.throwOnNextConstruct = true;
    const transport = createMockTransport();
    expect(() => renderHarness(transport)).not.toThrow();
    await flushMicrotasks();

    expect(toastError).toHaveBeenCalledWith('init failed');
    expect(FakeTerminal.instances).toHaveLength(0);
  });

  it('does not construct xterm if unmounted before the queued microtask runs', () => {
    const transport = createMockTransport();
    const { unmount } = renderHarness(transport);
    // Unmount synchronously, before the queueMicrotask callback has a chance
    // to run — this is exactly the fast-unmount race the `cancelled` flag
    // guards against.
    unmount();

    expect(FakeTerminal.instances).toHaveLength(0);
  });
});

describe('useTerminalSession — data flow', () => {
  it('forwards outgoing keystrokes to the transport', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    FakeTerminal.last().emitData('ls -la\n');

    expect(transport.sendData).toHaveBeenCalledWith({ sessionId: 'sess-1', data: 'ls -la\n' });
  });

  it('writes incoming frames addressed to this session and ignores others', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    transport.emit({ sessionId: 'sess-1', data: 'hello\n' });
    transport.emit({ sessionId: 'some-other-session', data: 'nope\n' });

    const terminal = FakeTerminal.last();
    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith('hello\n', expect.any(Function));
  });
});

describe('useTerminalSession — output flow control', () => {
  it('resets the flow count when a terminal attaches', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();
    expect(transport.ack).toHaveBeenCalledWith({ sessionId: 'sess-1', chars: 0, reset: true });
  });

  it('acknowledges parsed output in batches once xterm has processed it', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();
    const terminal = FakeTerminal.last();
    transport.ack.mockClear();

    const chunk = 'x'.repeat(40 * 1024);
    transport.emit({ sessionId: 'sess-1', data: chunk });
    transport.emit({ sessionId: 'sess-1', data: chunk });
    // Nothing is acknowledged on arrival — only when parsed.
    expect(transport.ack).not.toHaveBeenCalled();

    for (const call of terminal.write.mock.calls) (call[1] as () => void)();
    expect(transport.ack).toHaveBeenCalledTimes(1);
    expect(transport.ack).toHaveBeenCalledWith({ sessionId: 'sess-1', chars: 80 * 1024 });
  });
});

describe('useTerminalSession — cleanup', () => {
  it('disposes the terminal and unsubscribes the transport on unmount', async () => {
    const transport = createMockTransport();
    const { unmount } = renderHarness(transport);
    await flushMicrotasks();

    expect(transport.listenerCount()).toBe(1);
    const terminal = FakeTerminal.last();

    unmount();

    // Subscriptions go immediately; the terminal itself one macrotask later,
    // unless a remount in the same commit reclaims it (see the next test).
    expect(transport.listenerCount()).toBe(0);
    expect(terminal.dispose).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the same terminal — and its scrollback — when the pane is remounted', async () => {
    // Regression: splitting a pane moves it one level deeper in SplitLayout, so
    // React remounts it. The terminal used to be disposed on unmount and a new,
    // empty one constructed — every split wiped the surviving pane's history.
    const transport = createMockTransport();
    const { rerender } = render(
      <div key="before">
        <Harness transport={transport} logTag="Test" initErrorMessage="init failed" />
      </div>,
    );
    await flushMicrotasks();
    const terminal = FakeTerminal.last();
    transport.emit({ sessionId: 'sess-1', data: 'history\n' });

    // A different parent key forces an unmount + mount in one commit, which is
    // what a leaf turning into a split does.
    rerender(
      <div key="after">
        <Harness transport={transport} logTag="Test" initErrorMessage="init failed" />
      </div>,
    );
    await flushMicrotasks();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(terminal.open).toHaveBeenCalledTimes(1);
    // Still attached to the live transport after the move.
    transport.emit({ sessionId: 'sess-1', data: 'more\n' });
    expect(terminal.write).toHaveBeenLastCalledWith('more\n', expect.any(Function));
    expect(transport.listenerCount()).toBe(1);
  });

  it('runs the onReady cleanup on unmount', async () => {
    const transport = createMockTransport();
    const readyCleanup = vi.fn();
    const onReady = vi.fn(() => readyCleanup);
    const { unmount } = renderHarness(transport, { onReady });
    await flushMicrotasks();

    expect(onReady).toHaveBeenCalledTimes(1);
    unmount();

    expect(readyCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('useTerminalSession — WebGL fallback', () => {
  it('drops to the DOM renderer on context loss and warns only once', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    const webgl = FakeWebglAddon.last();

    webgl.triggerContextLoss();
    webgl.triggerContextLoss();

    // Disposing the WebGL addon is what hands rendering back to the DOM.
    expect(webgl.dispose).toHaveBeenCalledTimes(2);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });
});

describe('useTerminalSession — resize', () => {
  it('debounces and forwards cols/rows to the transport when the pane becomes active', async () => {
    const transport = createMockTransport();
    const { rerender } = renderHarness(transport, { isActive: false });
    await flushMicrotasks();

    vi.useFakeTimers();
    try {
      rerender(
        <Harness transport={transport} logTag="Test" initErrorMessage="init failed" isActive />,
      );
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(transport.resize).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', cols: 80, rows: 24 }),
      );
      expect(FakeFitAddon.last().fit).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refits a visible pane even when it is not the active one', async () => {
    // Regression: handleResize bailed for inactive panes, so in a split only
    // the focused pane followed a window/divider resize or a font change.
    // Hidden panes are still skipped — by the zero-size check, tested below.
    const transport = createMockTransport();
    renderHarness(transport, { isActive: false });
    await flushMicrotasks();
    const fit = FakeFitAddon.last().fit;
    fit.mockClear();

    vi.useFakeTimers();
    try {
      act(() => {
        useTerminalStore.setState({ fontSize: 15 });
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(fit).toHaveBeenCalledTimes(1);
    expect(transport.resize).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
  });
});

describe('useTerminalSession — live settings updates', () => {
  it('applies a theme change by refreshing the visible viewport', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    const terminal = FakeTerminal.last();
    act(() => {
      useTerminalStore.setState({ terminalTheme: 'nord' });
    });

    expect(terminal.refresh).toHaveBeenCalled();
  });

  it('applies font size and scrollback together and re-fits once', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    const terminal = FakeTerminal.last();
    const fitCallsBefore = FakeFitAddon.last().fit.mock.calls.length;
    vi.useFakeTimers();
    try {
      act(() => {
        useTerminalStore.setState({ fontSize: 20, scrollback: 5000 });
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(terminal.options.fontSize).toBe(20);
    expect(terminal.options.scrollback).toBe(5000);
    expect(FakeFitAddon.last().fit.mock.calls.length).toBe(fitCallsBefore + 1);
    // Regression: a font change alters cols/rows without resizing the
    // container, and the new geometry never reached the remote PTY.
    expect(transport.resize).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', cols: 80, rows: 24 }),
    );
  });
});

describe('useTerminalSession — screen reader mode', () => {
  it('constructs with the stored setting and applies changes live', async () => {
    useTerminalStore.setState({ screenReaderMode: false });
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();
    const terminal = FakeTerminal.last();
    expect(terminal.options.screenReaderMode).toBe(false);

    act(() => {
      useTerminalStore.setState({ screenReaderMode: true });
    });
    expect(terminal.options.screenReaderMode).toBe(true);
  });
});

describe('useTerminalSession — search', () => {
  it('findNext/findPrevious delegate to the search addon with the current query', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    act(() => {
      lastApi!.setSearchQuery('needle');
    });
    act(() => {
      lastApi!.findNext();
    });
    act(() => {
      lastApi!.findPrevious();
    });

    // With decorations: the addon only reports match counts when they're on.
    const withDecorations = expect.objectContaining({ decorations: expect.any(Object) });
    expect(FakeSearchAddon.last().findNext).toHaveBeenCalledWith('needle', withDecorations);
    expect(FakeSearchAddon.last().findPrevious).toHaveBeenCalledWith('needle', withDecorations);
  });

  it('closeSearch clears decorations, refocuses the terminal, and resets state', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    act(() => {
      lastApi!.setSearchQuery('needle');
    });
    act(() => {
      lastApi!.closeSearch();
    });

    expect(FakeSearchAddon.last().clearDecorations).toHaveBeenCalled();
    expect(FakeTerminal.last().focus).toHaveBeenCalled();
    expect(lastApi!.searchQuery).toBe('');
    expect(lastApi!.searchMatch).toBeNull();
  });
});

describe('useTerminalSession — zero-size resize guard', () => {
  /**
   * Views stay mounted and hidden with `display: none` (App.tsx), while
   * `isActive` tracks the active *pane* rather than view visibility — so the
   * active pane of a hidden view still reaches the resize path. fit() on a 0x0
   * element derives a nonsense geometry, and that geometry was then dispatched
   * to the remote as a window-size change.
   */
  it('does not dispatch a resize while the element measures zero', async () => {
    const transport = createMockTransport();
    const { rerender } = renderHarness(transport, { isActive: false });
    await flushMicrotasks();

    // Simulate the hidden case, overriding the size the fake reports on open().
    const element = FakeTerminal.last().element as HTMLElement;
    Object.defineProperty(element, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(element, 'offsetHeight', { value: 0, configurable: true });
    transport.resize.mockClear();

    vi.useFakeTimers();
    try {
      rerender(
        <Harness transport={transport} logTag="Test" initErrorMessage="init failed" isActive />,
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(transport.resize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
