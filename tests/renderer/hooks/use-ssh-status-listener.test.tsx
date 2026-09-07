// @vitest-environment jsdom
import type { SessionStatus } from '@shared/types/terminal';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSshStatusListener } from '../../../src/renderer/src/hooks/use-ssh-status-listener';
import { useTerminalStore } from '../../../src/renderer/src/stores/terminal-store';
import { createFakeApi, installFakeApi } from '../../../src/test/fake-api';

const SESSION = {
  id: 'sess-1',
  connectionId: 'conn-1',
  connectionName: 'Prod Box',
  status: 'connecting' as SessionStatus,
  title: 'Prod Box',
  type: 'ssh' as const,
};

let handler: ((e: { sessionId: string; status: SessionStatus }) => void) | null;
let unsubscribe: () => void;

beforeEach(() => {
  handler = null;
  unsubscribe = vi.fn<() => void>();

  installFakeApi({
    ssh: {
      ...createFakeApi().ssh,
      onStatus: vi.fn((cb: (e: { sessionId: string; status: SessionStatus }) => void) => {
        handler = cb;
        return unsubscribe;
      }),
    },
  });

  useTerminalStore.setState({ sessions: new Map([['sess-1', { ...SESSION }]]) });
});

describe('useSshStatusListener', () => {
  it('subscribes on mount, before any session exists', () => {
    useTerminalStore.setState({ sessions: new Map() });
    renderHook(() => useSshStatusListener());

    expect(handler).not.toBeNull();
  });

  it('applies a status event to the matching session', () => {
    renderHook(() => useSshStatusListener());

    act(() => {
      handler?.({ sessionId: 'sess-1', status: 'connected' });
    });

    expect(useTerminalStore.getState().sessions.get('sess-1')?.status).toBe('connected');
  });

  it('leaves other sessions untouched', () => {
    useTerminalStore.setState({
      sessions: new Map([
        ['sess-1', { ...SESSION }],
        ['sess-2', { ...SESSION, id: 'sess-2' }],
      ]),
    });
    renderHook(() => useSshStatusListener());

    act(() => {
      handler?.({ sessionId: 'sess-2', status: 'connected' });
    });

    expect(useTerminalStore.getState().sessions.get('sess-1')?.status).toBe('connecting');
    expect(useTerminalStore.getState().sessions.get('sess-2')?.status).toBe('connected');
  });

  it('ignores events for sessions the store does not know', () => {
    renderHook(() => useSshStatusListener());

    act(() => {
      handler?.({ sessionId: 'ghost', status: 'connected' });
    });

    expect(useTerminalStore.getState().sessions.size).toBe(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useSshStatusListener());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
