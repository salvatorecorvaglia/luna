// @vitest-environment jsdom
import type { SessionStatus } from '@shared/types/terminal';
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
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn() },
}));

import { LocalTerminalPane } from '../../../../src/renderer/src/components/terminal/LocalTerminalPane';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { createFakeApi, installFakeApi } from '../../../../src/test/fake-api';
import { FakeTerminal, resetFakeXterm } from '../../../../src/test/fake-xterm';

function capturingListener<T>() {
  let handler: ((e: T) => void) | null = null;
  const unsubscribe = vi.fn();
  const fn = vi.fn((cb: (e: T) => void) => {
    handler = cb;
    return unsubscribe;
  });
  return {
    fn,
    unsubscribe,
    emit(e: T) {
      handler?.(e);
    },
  };
}

type SpawnParams = { sessionId: string; cols: number; rows: number };

let onExit: ReturnType<typeof capturingListener<{ sessionId: string; exitCode: number }>>;
let spawn: ReturnType<typeof vi.fn<(params: SpawnParams) => Promise<void>>>;

beforeEach(() => {
  resetFakeXterm();
  toastError.mockClear();

  onExit = capturingListener();
  spawn = vi.fn<(params: SpawnParams) => Promise<void>>().mockResolvedValue(undefined);

  installFakeApi({
    localTerminal: {
      ...createFakeApi().localTerminal,
      spawn,
      onExit: onExit.fn,
    },
  });

  useTerminalStore.setState({
    sessions: new Map([
      [
        'local-1',
        {
          id: 'local-1',
          connectionId: 'local',
          connectionName: 'Local Shell',
          status: 'connected' as SessionStatus,
          title: 'Local Shell',
          type: 'local' as const,
        },
      ],
    ]),
  });
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LocalTerminalPane — spawn', () => {
  it('spawns exactly once with the terminal geometry', async () => {
    render(<LocalTerminalPane sessionId="local-1" />);
    await flush();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'local-1', cols: 80, rows: 24 }),
    );
  });

  it('does not re-spawn across a resize-driven re-render', async () => {
    const { rerender } = render(<LocalTerminalPane sessionId="local-1" isActive={false} />);
    await flush();
    rerender(<LocalTerminalPane sessionId="local-1" isActive />);
    await flush();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('shows a toast when spawning fails', async () => {
    spawn.mockRejectedValueOnce(new Error('pty allocation failed'));
    render(<LocalTerminalPane sessionId="local-1" />);
    await flush();

    expect(toastError).toHaveBeenCalledWith('Failed to start local terminal.');
  });
});

describe('LocalTerminalPane — exit handling', () => {
  it('writes a shell-exited banner and marks the session disconnected', async () => {
    render(<LocalTerminalPane sessionId="local-1" />);
    await flush();

    act(() => {
      onExit.emit({ sessionId: 'local-1', exitCode: 1 });
    });

    const writes = FakeTerminal.last().write.mock.calls.map((c) => String(c[0]));
    expect(writes.some((w) => w.includes('Shell exited (code 1)'))).toBe(true);
    expect(useTerminalStore.getState().sessions.get('local-1')?.status).toBe('disconnected');
  });

  it('ignores exit events for a different session', async () => {
    render(<LocalTerminalPane sessionId="local-1" />);
    await flush();

    onExit.emit({ sessionId: 'some-other-session', exitCode: 0 });

    expect(FakeTerminal.last().write).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions.get('local-1')?.status).toBe('connected');
  });
});

describe('LocalTerminalPane — cleanup', () => {
  it('unsubscribes the exit listener on unmount', async () => {
    const { unmount } = render(<LocalTerminalPane sessionId="local-1" />);
    await flush();
    unmount();

    expect(onExit.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
