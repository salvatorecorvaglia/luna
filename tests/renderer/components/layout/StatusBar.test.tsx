// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../../../../src/renderer/src/components/layout/StatusBar';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { useTransferStore } from '../../../../src/renderer/src/stores/transfer-store';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function session(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    connectionId: `conn-${id}`,
    connectionName: `Host ${id}`,
    status: 'connected' as const,
    title: `Tab ${id}`,
    // 'local' keeps hasSshSessions false, so the ['port-forwards'] query stays
    // disabled and its async resolution cannot perturb the render counts below.
    type: 'local' as const,
    ...overrides,
  };
}

beforeEach(() => {
  installFakeApi();
  useTerminalStore.setState({
    sessions: new Map(),
    tabOrder: [],
    activeSessionId: null,
    layouts: new Map(),
  });
  useTransferStore.setState({ transfers: new Map() });
});

describe('StatusBar', () => {
  it('shows the active session and the connected count', () => {
    act(() => {
      useTerminalStore.getState().addSession(session('a') as never);
      useTerminalStore.getState().addSession(session('b') as never);
    });

    act(() => {
      useTerminalStore.getState().setActiveSession('a');
    });

    render(wrap(<StatusBar />));

    expect(screen.getByTitle('Host a')).toBeTruthy();
    // Rendered on both sides of the bar (session count, and the idle-state
    // counter opposite the transfer indicator), hence getAllByText.
    expect(screen.getAllByText('2 sessions').length).toBeGreaterThan(0);
  });

  /**
   * The status bar is mounted for the whole life of the app, and it used to
   * subscribe to the `sessions` and `transfers` Maps directly. Both are replaced
   * wholesale on every mutation, so a tab rename — which changes nothing this bar
   * displays — re-rendered it, as did every animation frame of a transfer's
   * progress.
   *
   * Renaming is the clean discriminator: it changes the Map's identity and
   * nothing else.
   */
  it('does not re-render when an unrelated session is renamed', () => {
    act(() => {
      useTerminalStore.getState().addSession(session('a') as never);
      useTerminalStore.getState().addSession(session('b') as never);
    });

    let renders = 0;
    render(
      wrap(
        <Profiler
          id="status-bar"
          onRender={() => {
            renders += 1;
          }}
        >
          <StatusBar />
        </Profiler>,
      ),
    );

    const initial = renders;
    expect(initial).toBeGreaterThan(0);

    // 'a' is deliberately *not* the active session — addSession activates the
    // one it just added, so 'b' is active. Renaming 'a' therefore changes the
    // Map's identity and nothing the bar shows.
    act(() => {
      useTerminalStore.getState().renameTab('a', 'Renamed');
    });

    expect(renders).toBe(initial);
  });

  it('still re-renders when the connected count actually changes', () => {
    act(() => {
      useTerminalStore.getState().addSession(session('a') as never);
    });

    let renders = 0;
    render(
      wrap(
        <Profiler
          id="status-bar"
          onRender={() => {
            renders += 1;
          }}
        >
          <StatusBar />
        </Profiler>,
      ),
    );
    const initial = renders;

    act(() => {
      useTerminalStore.getState().addSession(session('b') as never);
    });

    expect(renders).toBeGreaterThan(initial);
    expect(screen.getAllByText('2 sessions').length).toBeGreaterThan(0);
  });
});
