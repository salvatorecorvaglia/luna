import { toastArgs } from '@shared/error-messages';
import { toast } from 'sonner';
import { getApi } from '@/services/api';
import { useStorageStore } from '@/stores/storage-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * Open an S3 storage session for the given connection. The session id can
 * then be passed to `storage:*` IPC calls (list/stat/upload/download/...).
 *
 * Mirrors `connectToHost` (lib/ssh.ts) for symmetry.
 */
/**
 * Connects in flight, per connection. The existing-session checks below all
 * pass for a double-click (nothing is connected yet), so each click opened its
 * own S3 session; concurrent calls now share one attempt.
 */
const inFlight = new Map<string, Promise<string | null>>();

export function connectToS3(connectionId: string): Promise<string | null> {
  const pending = inFlight.get(connectionId);
  if (pending) return pending;
  const attempt = connectToS3Once(connectionId).finally(() => {
    if (inFlight.get(connectionId) === attempt) inFlight.delete(connectionId);
  });
  inFlight.set(connectionId, attempt);
  return attempt;
}

async function connectToS3Once(connectionId: string): Promise<string | null> {
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
      const { s3 } = await getApi().app.getActiveSessions();
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

  const sessionId = crypto.randomUUID();

  let connectionName = 'S3';
  let initialPath = '/';
  try {
    const conn = await getApi().connections.get(connectionId);
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
    await getApi().s3.connect({ sessionId, connectionId });
    updateStorageSessionStatus(sessionId, 'connected');
    setActiveSessionId(sessionId);
    // Like the two existing-session branches above; this one alone left the
    // user on whatever view they were in.
    useUIStore.getState().setActiveView('sftp');
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
    await getApi().s3.disconnect(sessionId);
  } catch {
    // best-effort
  }
  removeStorageSession(sessionId);
  if (activeSessionId === sessionId) setActiveSessionId(null);
}
