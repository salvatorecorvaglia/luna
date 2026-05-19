import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { toastArgs } from '@shared/error-messages';
import { useStorageStore } from '@/stores/storage-store';
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
    setActiveSessionId,
  } = useStorageStore.getState();

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
        setActiveSessionId(sess.id);
        useUIStore.getState().setActiveView('sftp');
        return sess.id;
      }
    } catch (err) {
      console.error('Failed to check active sessions:', err);
    }
  }

  if (existing) {
    setActiveSessionId(existing.id);
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
    setActiveSessionId(sessionId);
    return sessionId;
  } catch (err: unknown) {
    toast.error(...toastArgs(err, 'S3 connection failed'));
    removeStorageSession(sessionId);
    return null;
  }
}

export async function disconnectS3(sessionId: string): Promise<void> {
  const { removeStorageSession, activeSessionId, setActiveSessionId } = useStorageStore.getState();
  try {
    await window.api.s3.disconnect(sessionId);
  } catch {
    // best-effort
  }
  removeStorageSession(sessionId);
  if (activeSessionId === sessionId) setActiveSessionId(null);
}
