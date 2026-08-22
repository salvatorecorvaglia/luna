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
vi.mock('@xterm/addon-canvas', async () => {
  const { FakeCanvasAddon } = await import('../../../../src/test/fake-xterm');
  return { CanvasAddon: FakeCanvasAddon };
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
import { useTerminalSession } from '../../../../src/renderer/src/components/terminal/use-terminal-session';
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
    expect(terminal.write).toHaveBeenCalledWith('hello\n');
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

    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(transport.listenerCount()).toBe(0);
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
  it('falls back to the Canvas addon on context loss and warns only once', async () => {
    const transport = createMockTransport();
    renderHarness(transport);
    await flushMicrotasks();

    const terminal = FakeTerminal.last();
    const webgl = FakeWebglAddon.last();
    const loadAddonCallsBefore = terminal.loadAddon.mock.calls.length;

    webgl.triggerContextLoss();
    webgl.triggerContextLoss();

    expect(webgl.dispose).toHaveBeenCalledTimes(2);
    expect(terminal.loadAddon.mock.calls.length).toBeGreaterThan(loadAddonCallsBefore);
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

  it('drops a queued resize if the pane goes inactive before the debounce fires', async () => {
    const transport = createMockTransport();
    const { rerender } = renderHarness(transport, { isActive: false });
    await flushMicrotasks();

    vi.useFakeTimers();
    try {
      rerender(
        <Harness transport={transport} logTag="Test" initErrorMessage="init failed" isActive />,
      );
      rerender(
        <Harness
          transport={transport}
          logTag="Test"
          initErrorMessage="init failed"
          isActive={false}
        />,
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
    act(() => {
      useTerminalStore.setState({ fontSize: 20, scrollback: 5000 });
    });

    expect(terminal.options.fontSize).toBe(20);
    expect(terminal.options.scrollback).toBe(5000);
    expect(FakeFitAddon.last().fit.mock.calls.length).toBe(fitCallsBefore + 1);
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

    expect(FakeSearchAddon.last().findNext).toHaveBeenCalledWith('needle');
    expect(FakeSearchAddon.last().findPrevious).toHaveBeenCalledWith('needle');
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
