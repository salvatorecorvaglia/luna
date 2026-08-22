// @vitest-environment jsdom

import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore } from '../../../src/renderer/src/stores/terminal-store';
import { installFakeApi } from '../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

describe('terminal-store-splits', () => {
  const sshConnect = vi.fn();
  const sshDisconnect = vi.fn();
  const localKill = vi.fn();

  beforeEach(() => {
    sshConnect.mockReset();
    sshDisconnect.mockReset();
    localKill.mockReset();

    (globalThis as unknown as { window: Window }).window =
      (globalThis as unknown as { window: Window }).window ||
      (globalThis as unknown as { window: Window });

    Object.assign(window, {
      api: {
        ssh: {
          connect: sshConnect.mockResolvedValue({ success: true }),
          disconnect: sshDisconnect,
        },
        localTerminal: {
          kill: localKill,
        },
        settings: {
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    // Reset store state
    useTerminalStore.setState({
      sessions: new Map(),
      tabOrder: [],
      activeSessionId: null,
      layouts: new Map(),
    });
  });

  it('initializes a single tab and layout when a session is added', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connecting',
      title: 'Test Server',
      type: 'ssh',
    });

    const state = useTerminalStore.getState();
    expect(state.tabOrder).toEqual(['session-1']);
    expect(state.activeSessionId).toBe('session-1');
    expect(state.layouts.get('session-1')).toEqual({
      type: 'terminal',
      sessionId: 'session-1',
    });
  });

  it('splits an existing tab vertically', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connected',
      title: 'Test Server',
      type: 'ssh',
    });

    useTerminalStore.getState().splitSession('session-1', 'vertical');

    const state = useTerminalStore.getState();
    expect(state.sessions.size).toBe(2);

    const root = state.layouts.get('session-1');
    expect(root?.type).toBe('split');
    if (root?.type === 'split') {
      expect(root.direction).toBe('vertical');
      const left = root.children[0];
      const right = root.children[1];
      expect(left.type).toBe('terminal');
      expect(right.type).toBe('terminal');
      if (left.type === 'terminal' && right.type === 'terminal') {
        expect(left.sessionId).toBe('session-1');
        const newSessionId = right.sessionId;
        expect(state.activeSessionId).toBe(newSessionId);
        expect(sshConnect).toHaveBeenCalledWith({
          connectionId: 'conn-1',
          sessionId: newSessionId,
        });
      }
    }
  });

  it('splits an existing tab horizontally', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connected',
      title: 'Test Server',
      type: 'ssh',
    });

    useTerminalStore.getState().splitSession('session-1', 'horizontal');

    const state = useTerminalStore.getState();
    const root = state.layouts.get('session-1');
    expect(root?.type).toBe('split');
    if (root?.type === 'split') {
      expect(root.direction).toBe('horizontal');
      const left = root.children[0];
      expect(left.type).toBe('terminal');
      if (left.type === 'terminal') {
        expect(left.sessionId).toBe('session-1');
      }
    }
  });

  it('removes a session from a split layout, promoting the remaining sibling', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connected',
      title: 'Test Server',
      type: 'ssh',
    });

    useTerminalStore.getState().splitSession('session-1', 'vertical');
    const stateBeforeClose = useTerminalStore.getState();
    const rootBeforeClose = stateBeforeClose.layouts.get('session-1');
    expect(rootBeforeClose?.type).toBe('split');
    let splitSessionId = '';
    if (rootBeforeClose?.type === 'split') {
      const right = rootBeforeClose.children[1];
      expect(right.type).toBe('terminal');
      if (right.type === 'terminal') {
        splitSessionId = right.sessionId;
      }
    }

    // Close the split pane (sibling session)
    useTerminalStore.getState().closeTab(splitSessionId);

    const stateAfterClose = useTerminalStore.getState();
    expect(stateAfterClose.sessions.size).toBe(1);
    expect(stateAfterClose.layouts.get('session-1')).toEqual({
      type: 'terminal',
      sessionId: 'session-1',
    });
    expect(stateAfterClose.activeSessionId).toBe('session-1');
    expect(sshDisconnect).toHaveBeenCalledWith(splitSessionId);
  });

  it('removes the entire tab if its last split pane is closed', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connected',
      title: 'Test Server',
      type: 'ssh',
    });

    useTerminalStore.getState().closeTab('session-1');

    const state = useTerminalStore.getState();
    expect(state.sessions.size).toBe(0);
    expect(state.tabOrder).toEqual([]);
    expect(state.layouts.size).toBe(0);
    expect(state.activeSessionId).toBeNull();
    expect(sshDisconnect).toHaveBeenCalledWith('session-1');
  });

  it('updates split ratio', () => {
    const store = useTerminalStore.getState();
    store.addSession({
      id: 'session-1',
      connectionId: 'conn-1',
      connectionName: 'Test Server',
      status: 'connected',
      title: 'Test Server',
      type: 'ssh',
    });

    useTerminalStore.getState().splitSession('session-1', 'vertical');
    useTerminalStore.getState().updateSplitRatio('session-1', 'session-1', 0.7);

    const state = useTerminalStore.getState();
    const root = state.layouts.get('session-1');
    expect(root?.type).toBe('split');
    if (root?.type === 'split') {
      expect(root.ratio).toBe(0.7);
    }
  });

  it('provides working slice selectors', () => {
    useTerminalStore.setState({
      activeSessionId: 'session-99',
      fontSize: 16,
      terminalTheme: 'tokyo-night',
      tabOrder: ['session-99'],
      sessions: new Map([
        [
          'session-99',
          {
            id: 'session-99',
            connectionId: 'conn-99',
            connectionName: 'Server 99',
            status: 'connected',
            title: 'Server 99',
          },
        ],
      ]),
    });

    const state = useTerminalStore.getState();
    expect(state.activeSessionId).toBe('session-99');
    expect(state.fontSize).toBe(16);
    expect(state.terminalTheme).toBe('tokyo-night');
    expect(state.tabOrder).toEqual(['session-99']);
    expect(state.sessions.get('session-99')?.connectionName).toBe('Server 99');
  });

  describe('closeOtherTabs', () => {
    it('keeps only the target tab, disposing every session in the closed tabs', () => {
      const store = useTerminalStore.getState();
      store.addSession({
        id: 'session-a',
        connectionId: 'conn-a',
        connectionName: 'A',
        status: 'connected',
        title: 'A',
        type: 'ssh',
      });
      store.addSession({
        id: 'session-b',
        connectionId: 'conn-b',
        connectionName: 'B',
        status: 'connected',
        title: 'B',
        type: 'ssh',
      });
      store.addSession({
        id: 'session-c',
        connectionId: 'conn-c',
        connectionName: 'C',
        status: 'connected',
        title: 'C',
        type: 'ssh',
      });
      // Give tab B a second, split-off leaf so closing "other tabs" has to
      // walk a multi-leaf pane tree, not just single-session tabs.
      useTerminalStore.getState().splitSession('session-b', 'vertical');
      const splitSiblingId = Array.from(useTerminalStore.getState().sessions.keys()).find(
        (id) => !['session-a', 'session-b', 'session-c'].includes(id),
      )!;

      useTerminalStore.getState().closeOtherTabs('session-b');

      const state = useTerminalStore.getState();
      expect(state.tabOrder).toEqual(['session-b']);
      expect(Array.from(state.sessions.keys()).sort()).toEqual(
        ['session-b', splitSiblingId].sort(),
      );
      expect(state.activeSessionId).toBe('session-b');
      expect(sshDisconnect).toHaveBeenCalledWith('session-a');
      expect(sshDisconnect).toHaveBeenCalledWith('session-c');
      expect(sshDisconnect).not.toHaveBeenCalledWith('session-b');
      expect(sshDisconnect).not.toHaveBeenCalledWith(splitSiblingId);
    });

    it('is a no-op when the session is not part of any tracked tab', () => {
      useTerminalStore.getState().closeOtherTabs('does-not-exist');

      const state = useTerminalStore.getState();
      expect(state.sessions.size).toBe(0);
      expect(state.tabOrder).toEqual([]);
    });
  });

  describe('closeTabsToRight', () => {
    function addThreeTabs(): void {
      const store = useTerminalStore.getState();
      store.addSession({
        id: 'session-a',
        connectionId: 'conn-a',
        connectionName: 'A',
        status: 'connected',
        title: 'A',
        type: 'ssh',
      });
      store.addSession({
        id: 'session-b',
        connectionId: 'conn-b',
        connectionName: 'B',
        status: 'connected',
        title: 'B',
        type: 'ssh',
      });
      store.addSession({
        id: 'session-c',
        connectionId: 'conn-c',
        connectionName: 'C',
        status: 'connected',
        title: 'C',
        type: 'ssh',
      });
    }

    it('closes every tab after the target and disposes their sessions', () => {
      addThreeTabs();

      useTerminalStore.getState().closeTabsToRight('session-a');

      const state = useTerminalStore.getState();
      expect(state.tabOrder).toEqual(['session-a']);
      expect(Array.from(state.sessions.keys())).toEqual(['session-a']);
      expect(sshDisconnect).toHaveBeenCalledWith('session-b');
      expect(sshDisconnect).toHaveBeenCalledWith('session-c');
    });

    it('keeps the current active session when it is not in a closed tab', () => {
      addThreeTabs();
      useTerminalStore.getState().setActiveSession('session-a');

      useTerminalStore.getState().closeTabsToRight('session-a');

      expect(useTerminalStore.getState().activeSessionId).toBe('session-a');
    });

    it('falls back to the target tab when the active session was closed', () => {
      addThreeTabs();
      // addSession left activeSessionId on 'session-c', which is about to close.

      useTerminalStore.getState().closeTabsToRight('session-a');

      expect(useTerminalStore.getState().activeSessionId).toBe('session-a');
    });

    it('is a no-op when the session is not part of any tracked tab', () => {
      addThreeTabs();
      const before = useTerminalStore.getState().tabOrder;

      useTerminalStore.getState().closeTabsToRight('does-not-exist');

      expect(useTerminalStore.getState().tabOrder).toEqual(before);
    });
  });

  describe('initializeSettings', () => {
    it('applies only the fields that are present and mirrors them to localStorage', () => {
      useTerminalStore.getState().initializeSettings({ theme: 'nord', scrollback: 5000 });

      const state = useTerminalStore.getState();
      expect(state.terminalTheme).toBe('nord');
      expect(state.scrollback).toBe(5000);
      expect(localStorage.getItem('luna-terminal-theme')).toBe('nord');
      expect(localStorage.getItem('luna-terminal-scrollback')).toBe('5000');
      // fontSize wasn't in the payload — untouched.
      expect(localStorage.getItem('luna-terminal-font-size')).toBeNull();
    });

    it('clamps out-of-range values the same way the individual setters do', () => {
      useTerminalStore.getState().initializeSettings({ fontSize: 999 });

      // LIMITS.MAX_FONT_SIZE
      expect(useTerminalStore.getState().fontSize).toBe(32);
    });
  });
});

describe('terminal-store — settings persistence failure', () => {
  // installFakeApi sets services/api.ts's `override` seam, which getApi()
  // checks before its own memoised `wrapped` cache — required here because
  // that cache is built once from the very first getApi() call in this file
  // and never rebuilds from a later `window.api` reassignment.
  const settingsSet = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

  beforeEach(() => {
    settingsSet.mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    installFakeApi({ settings: { get: vi.fn(), set: settingsSet, getAll: vi.fn() } });
  });

  it('surfaces a toast when persisting the terminal theme fails, but still applies it locally', async () => {
    useTerminalStore.getState().setTerminalTheme('nord');

    expect(useTerminalStore.getState().terminalTheme).toBe('nord');
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to save terminal theme'),
    );
  });

  it('surfaces a toast when persisting font size fails, but still applies it locally', async () => {
    useTerminalStore.getState().setFontSize(18);

    expect(useTerminalStore.getState().fontSize).toBe(18);
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to save terminal font size'),
    );
  });

  it('surfaces a toast when persisting scrollback fails, but still applies it locally', async () => {
    useTerminalStore.getState().setScrollback(5000);

    expect(useTerminalStore.getState().scrollback).toBe(5000);
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to save terminal scrollback setting'),
    );
  });
});
