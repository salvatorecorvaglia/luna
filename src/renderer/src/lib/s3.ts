import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useSftpStore } from '@/stores/sftp-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * Open an S3 storage session for the given connection. The session id can
 * then be passed to `storage:*` IPC calls (list/stat/upload/download/...).
 *
 * Mirrors `connectToHost` (lib/ssh.ts) for symmetry.
 */
export async function connectToS3(connectionId: string): Promise<string | null> {
  const {
    storageSessions,
    addStorageSession,
    updateStorageSessionStatus,
    removeStorageSession,
    setSftpSessionId,
  } = useSftpStore.getState();

  // 1. Check local store
  const existing = Array.from(storageSessions.values()).find(
    (s) => s.connectionId === connectionId && s.status === 'connected',
  );

  // 2. If not in store, check main process (prevents race after Cmd+R)
  if (!existing) {
    try {
      const { s3 } = await window.api.app.getActiveSessions();
      const sess = s3.find((s) => s.connectionId === connectionId);
      if (sess) {
        addStorageSession({
          id: sess.id,
          connectionId: sess.connectionId,
          connectionName: sess.connectionName,
          provider: 's3',
          status: 'connected',
          initialPath: sess.initialPath,
        });
        setSftpSessionId(sess.id);
        useUIStore.getState().setActiveView('sftp');
        return sess.id;
      }
    } catch (err) {
      console.error('Failed to check active sessions:', err);
    }
  }

  if (existing) {
    setSftpSessionId(existing.id);
    useUIStore.getState().setActiveView('sftp');
    return existing.id;
  }

  const sessionId = uuidv4();

  let connectionName = 'S3';
  let initialPath = '/';
  try {
    const conn = await window.api.connections.get(connectionId);
    if (conn) {
      connectionName = conn.name;
      if (conn.defaultBucket) initialPath = `/${conn.defaultBucket}`;
    }
  } catch {
    // ignore — surfaced by connect failure below
  }

  addStorageSession({
    id: sessionId,
    connectionId,
    connectionName,
    provider: 's3',
    status: 'connecting',
    initialPath,
  });

  try {
    await window.api.s3.connect({ sessionId, connectionId });
    updateStorageSessionStatus(sessionId, 'connected');
    setSftpSessionId(sessionId);
    return sessionId;
  } catch (err: unknown) {
    toast.error(`S3 connection failed: ${err instanceof Error ? err.message : String(err)}`);
    removeStorageSession(sessionId);
    return null;
  }
}

export async function disconnectS3(sessionId: string): Promise<void> {
  const { removeStorageSession, sftpSessionId, setSftpSessionId } = useSftpStore.getState();
  try {
    await window.api.s3.disconnect(sessionId);
  } catch {
    // best-effort
  }
  removeStorageSession(sessionId);
  if (sftpSessionId === sessionId) setSftpSessionId(null);
}
