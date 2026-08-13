// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const terminalSessions = new Map<string, unknown>();
const addTerminalSession = vi.fn((s: unknown) => {
  terminalSessions.set((s as { id: string }).id, s);
});

const storageSessions = new Map<string, unknown>();
const addStorageSession = vi.fn((s: unknown) => {
  storageSessions.set((s as { id: string }).id, s);
});

let activeSessionId: string | null = null;
const setActiveSessionId = vi.fn((id: string | null) => {
  activeSessionId = id;
});

vi.mock('@/stores/terminal-store', () => ({
  useTerminalStore: {
    getState: () => ({
      sessions: terminalSessions,
      addSession: addTerminalSession,
    }),
  },
}));

vi.mock('@/stores/storage-store', () => ({
  useStorageStore: {
    getState: () => ({
      storageSessions,
      addStorageSession,
      activeSessionId,
      setActiveSessionId,
    }),
  },
}));

const getActiveSessions = vi.fn();
const getConnection = vi.fn();

beforeEach(() => {
  terminalSessions.clear();
  storageSessions.clear();
  addTerminalSession.mockClear();
  addStorageSession.mockClear();
  setActiveSessionId.mockClear();
  activeSessionId = null;
  getActiveSessions.mockReset();
  getConnection.mockReset();
  Object.assign(window, {
    api: {
      app: { getActiveSessions },
      connections: { get: getConnection },
    },
  });
});

async function mountAndWait() {
  const { useSessionRecovery } = await import('../../../src/renderer/src/hooks/use-session-recovery');
  renderHook(() => useSessionRecovery());
  // Recovery runs an async IIFE inside useEffect; let microtasks settle.
  await waitFor(() => expect(getActiveSessions).toHaveBeenCalled());
  // The post-await branches run in additional microtask turns.
  await new Promise((r) => setTimeout(r, 0));
}

describe('useSessionRecovery', () => {
  it('adds previously-unknown SSH sessions with the connection name', async () => {
    getActiveSessions.mockResolvedValue({
      ssh: [{ id: 's1', connectionId: 'c1', status: 'connected' }],
      s3: [],
    });
    getConnection.mockResolvedValue({ name: 'prod' });
    await mountAndWait();
    expect(addTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', connectionId: 'c1', connectionName: 'prod' }),
    );
  });

  it('falls back to "SSH" when the connection lookup fails', async () => {
    getActiveSessions.mockResolvedValue({
      ssh: [{ id: 's1', connectionId: 'c1', status: 'connected' }],
      s3: [],
    });
    getConnection.mockRejectedValue(new Error('gone'));
    await mountAndWait();
    expect(addTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', connectionName: 'SSH' }),
    );
  });

  it('does not re-add SSH sessions already in the store', async () => {
    terminalSessions.set('existing', { id: 'existing' });
    getActiveSessions.mockResolvedValue({
      ssh: [{ id: 'existing', connectionId: 'c1', status: 'connected' }],
      s3: [],
    });
    await mountAndWait();
    expect(addTerminalSession).not.toHaveBeenCalled();
  });

  it('adds previously-unknown S3 sessions', async () => {
    getActiveSessions.mockResolvedValue({
      ssh: [],
      s3: [
        {
          id: 'r1',
          connectionId: 'c1',
          connectionName: 'mybucket',
          initialPath: '/mybucket',
        },
      ],
    });
    await mountAndWait();
    expect(addStorageSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', provider: 's3', status: 'connected' }),
    );
  });

  it('clears activeSessionId when it points to a session that is gone', async () => {
    activeSessionId = 'orphan';
    getActiveSessions.mockResolvedValue({ ssh: [], s3: [] });
    await mountAndWait();
    expect(setActiveSessionId).toHaveBeenCalledWith(null);
  });

  it('keeps activeSessionId when it matches a recovered session', async () => {
    activeSessionId = 'r1';
    getActiveSessions.mockResolvedValue({
      ssh: [],
      s3: [{ id: 'r1', connectionId: 'c1', connectionName: 'b', initialPath: '/b' }],
    });
    await mountAndWait();
    expect(setActiveSessionId).not.toHaveBeenCalled();
  });

  it('swallows errors from getActiveSessions without crashing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getActiveSessions.mockRejectedValue(new Error('boom'));
    await mountAndWait();
    expect(errSpy).toHaveBeenCalledWith('Failed to recover sessions:', expect.any(Error));
    errSpy.mockRestore();
  });
});
