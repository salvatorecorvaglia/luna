// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const terminalSessions = new Map<string, unknown>();
const addTerminalSession = vi.fn((s: unknown) => {
  terminalSessions.set((s as { id: string }).id, s);
});

const storageSessions = new Map<string, unknown>();
const addStorageSession = vi.fn((s: unknown) => {
  storageSessions.set((s as { id: string }).id, s);
});

let sftpSessionId: string | null = null;
const setSftpSessionId = vi.fn((id: string | null) => {
  sftpSessionId = id;
});

vi.mock('@/stores/terminal-store', () => ({
  useTerminalStore: {
    getState: () => ({
      sessions: terminalSessions,
      addSession: addTerminalSession,
    }),
  },
}));

vi.mock('@/stores/sftp-store', () => ({
  useSftpStore: {
    getState: () => ({
      storageSessions,
      addStorageSession,
      sftpSessionId,
      setSftpSessionId,
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
  setSftpSessionId.mockClear();
  sftpSessionId = null;
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
  const { useSessionRecovery } = await import('../use-session-recovery');
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

  it('clears sftpSessionId when it points to a session that is gone', async () => {
    sftpSessionId = 'orphan';
    getActiveSessions.mockResolvedValue({ ssh: [], s3: [] });
    await mountAndWait();
    expect(setSftpSessionId).toHaveBeenCalledWith(null);
  });

  it('keeps sftpSessionId when it matches a recovered session', async () => {
    sftpSessionId = 'r1';
    getActiveSessions.mockResolvedValue({
      ssh: [],
      s3: [{ id: 'r1', connectionId: 'c1', connectionName: 'b', initialPath: '/b' }],
    });
    await mountAndWait();
    expect(setSftpSessionId).not.toHaveBeenCalled();
  });

  it('swallows errors from getActiveSessions without crashing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getActiveSessions.mockRejectedValue(new Error('boom'));
    await mountAndWait();
    expect(errSpy).toHaveBeenCalledWith('Failed to recover sessions:', expect.any(Error));
    errSpy.mockRestore();
  });
});
