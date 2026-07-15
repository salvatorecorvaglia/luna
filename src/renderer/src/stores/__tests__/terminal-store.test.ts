// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalStore } from '../terminal-store';

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
          set: vi.fn(),
        },
      },
    });

    // Reset store state
    useTerminalStore.setState({
      sessions: new Map(),
      tabOrder: [],
      activeTabId: null,
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
    expect(state.activeTabId).toBe('session-1');
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
      expect(root.children[0].type).toBe('terminal');
      expect(root.children[0].sessionId).toBe('session-1');
      expect(root.children[1].type).toBe('terminal');
      const newSessionId = root.children[1].sessionId;
      expect(state.activeTabId).toBe(newSessionId);
      expect(sshConnect).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        sessionId: newSessionId,
      });
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
      expect(root.children[0].sessionId).toBe('session-1');
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
      splitSessionId = rootBeforeClose.children[1].sessionId;
    }

    // Close the split pane (sibling session)
    useTerminalStore.getState().closeTab(splitSessionId);

    const stateAfterClose = useTerminalStore.getState();
    expect(stateAfterClose.sessions.size).toBe(1);
    expect(stateAfterClose.layouts.get('session-1')).toEqual({
      type: 'terminal',
      sessionId: 'session-1',
    });
    expect(stateAfterClose.activeTabId).toBe('session-1');
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
    expect(state.activeTabId).toBeNull();
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
});
