// @vitest-environment jsdom
import type { SessionStatus, SshConnectParams, SshConnectResult } from '@shared/types/terminal';
import { act, render, screen } from '@testing-library/react';
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
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn() },
}));

import { TerminalPane } from '../../../../src/renderer/src/components/terminal/TerminalPane';
import { __disposeAllTerminals } from '../../../../src/renderer/src/components/terminal/use-terminal-session';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { createFakeApi, installFakeApi } from '../../../../src/test/fake-api';
import { FakeTerminal, resetFakeXterm } from '../../../../src/test/fake-xterm';

/** Captures the last-registered callback for a `getApi().ssh.onX` subscription. */
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

const SESSION = {
  id: 'sess-1',
  connectionId: 'conn-1',
  connectionName: 'Prod Box',
  status: 'connected' as SessionStatus,
  title: 'Prod Box',
  type: 'ssh' as const,
};

let onClose: ReturnType<typeof capturingListener<{ sessionId: string }>>;
let onError: ReturnType<typeof capturingListener<{ sessionId: string; error: string }>>;
let onStatus: ReturnType<typeof capturingListener<{ sessionId: string; status: SessionStatus }>>;
let sshConnect: ReturnType<typeof vi.fn<(params: SshConnectParams) => Promise<SshConnectResult>>>;

beforeEach(() => {
  // Cached terminals outlive unmount by one macrotask (see liveTerminals);
  // drop them so each test constructs its own.
  __disposeAllTerminals();
  resetFakeXterm();
  toastError.mockClear();

  onClose = capturingListener();
  onError = capturingListener();
  onStatus = capturingListener();
  sshConnect = vi
    .fn<(params: SshConnectParams) => Promise<SshConnectResult>>()
    .mockResolvedValue({ success: true });

  installFakeApi({
    ssh: {
      ...createFakeApi().ssh,
      connect: sshConnect,
      onClose: onClose.fn,
      onError: onError.fn,
      onStatus: onStatus.fn,
    },
  });

  useTerminalStore.setState({
    sessions: new Map([['sess-1', { ...SESSION }]]),
  });
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TerminalPane — onReady event wiring', () => {
  it('writes a close banner to the terminal when this session closes', async () => {
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    onClose.emit({ sessionId: 'sess-1' });

    const writes = FakeTerminal.last().write.mock.calls.map((c) => c[0]);
    expect(writes.some((w) => String(w).includes('Connection closed'))).toBe(true);
  });

  it('ignores close events for a different session', async () => {
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    onClose.emit({ sessionId: 'some-other-session' });

    expect(FakeTerminal.last().write).not.toHaveBeenCalled();
  });

  it('writes a sanitized error banner when this session errors', async () => {
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    onError.emit({ sessionId: 'sess-1', error: 'connection reset\x07' });

    const writes = FakeTerminal.last().write.mock.calls.map((c) => String(c[0]));
    expect(writes.some((w) => w.includes('connection reset'))).toBe(true);
    // Control characters in the error text must not reach xterm verbatim.
    expect(writes.some((w) => w.includes('\x07'))).toBe(false);
  });

  // Status events are wired app-wide by useSshStatusListener (see its test),
  // not from the pane — subscribing here would miss a handshake that completes
  // before xterm mounts.
  it('does not subscribe to status events', async () => {
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    expect(onStatus.fn).not.toHaveBeenCalled();
  });
});

describe('TerminalPane — reconnect overlay', () => {
  it('is hidden while connected', async () => {
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    expect(screen.queryByRole('group', { name: /disconnected|connection error/i })).toBeNull();
  });

  it('is shown with a reconnect action when the session errors', async () => {
    useTerminalStore.setState({
      sessions: new Map([['sess-1', { ...SESSION, status: 'error' }]]),
    });
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    expect(screen.getByRole('group', { name: /connection error/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('does not trap the keyboard or take focus when the pane is not active', async () => {
    // Regression: every disconnected pane — hidden tabs included — installed a
    // window-level focus trap, so Tab anywhere in the app was redirected to an
    // invisible Reconnect button and open dialogs lost Escape.
    useTerminalStore.setState({
      sessions: new Map([['sess-1', { ...SESSION, status: 'disconnected' }]]),
    });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    render(<TerminalPane sessionId="sess-1" isActive={false} />);
    await flush();

    expect(document.activeElement).toBe(outside);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    outside.remove();
  });

  it('moves focus to Reconnect when the disconnected pane is the active one', async () => {
    useTerminalStore.setState({
      sessions: new Map([['sess-1', { ...SESSION, status: 'disconnected' }]]),
    });
    render(<TerminalPane sessionId="sess-1" isActive />);
    await flush();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /reconnect/i }));
  });

  it('reverts to the previous status and toasts on a failed reconnect', async () => {
    useTerminalStore.setState({
      sessions: new Map([['sess-1', { ...SESSION, status: 'disconnected' }]]),
    });
    sshConnect.mockRejectedValueOnce(new Error('host unreachable'));
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    const reconnectBtn = screen.getByRole('button', { name: /reconnect/i });
    await act(async () => {
      reconnectBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sshConnect).toHaveBeenCalledWith({ connectionId: 'conn-1', sessionId: 'sess-1' });
    expect(useTerminalStore.getState().sessions.get('sess-1')?.status).toBe('disconnected');
    expect(toastError).toHaveBeenCalledWith('Failed to reconnect');
  });

  it('leaves status at connecting on a successful reconnect', async () => {
    useTerminalStore.setState({
      sessions: new Map([['sess-1', { ...SESSION, status: 'disconnected' }]]),
    });
    render(<TerminalPane sessionId="sess-1" />);
    await flush();

    const reconnectBtn = screen.getByRole('button', { name: /reconnect/i });
    await act(async () => {
      reconnectBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useTerminalStore.getState().sessions.get('sess-1')?.status).toBe('connecting');
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('TerminalPane — cleanup', () => {
  it('unsubscribes both ssh event listeners on unmount', async () => {
    const { unmount } = render(<TerminalPane sessionId="sess-1" />);
    await flush();
    unmount();

    expect(onClose.unsubscribe).toHaveBeenCalledTimes(1);
    expect(onError.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
