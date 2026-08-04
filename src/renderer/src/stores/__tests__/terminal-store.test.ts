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
});
