import { toastArgs } from '@shared/error-messages';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

// Tracks connection attempts already in flight so a double-click on the
// Connect button cannot create two parallel sessions for the same host.
const inFlight = new Set<string>();

/**
 * Focus an existing session for this connection, or open a new one.
 *
 * This is the "click the connection in the sidebar" behaviour. It is
 * deliberately *not* what Duplicate Session / New Session want — see
 * `openNewSession`.
 */
export async function connectToHost(connectionId: string): Promise<void> {
  if (inFlight.has(connectionId)) return;
  inFlight.add(connectionId);
  try {
    await connectToHostImpl(connectionId);
  } finally {
    inFlight.delete(connectionId);
  }
}

/**
 * Always open an additional session for this connection, even when one is
 * already connected.
 *
 * "Duplicate Session" and the empty-state "New Session" button used to call
 * `connectToHost`, which focuses an existing connected session instead of
 * creating one — so in practice (the tab is always connected when you right-
 * click it) both commands just re-selected the tab you started from and
 * appeared to do nothing.
 *
 * There is no `inFlight` guard here: opening two sessions is the entire point,
 * so de-duplicating by connectionId would be wrong.
 */
export async function openNewSession(connectionId: string): Promise<void> {
  await spawnSession(connectionId);
}

async function connectToHostImpl(connectionId: string): Promise<void> {
  const { sessions, addSession, setActiveSession } = useTerminalStore.getState();

  // 1. Check local store
  const existing = Array.from(sessions.values()).find(
    (s) => s.connectionId === connectionId && s.status === 'connected',
  );

  // 2. If not in store, check main process (prevents race after Cmd+R)
  if (!existing) {
    try {
      const { ssh } = await getApi().app.getActiveSessions();
      const sess = ssh.find((s) => s.connectionId === connectionId);
      if (sess) {
        let connectionName = 'SSH';
        const conn = await getApi().connections.get(sess.connectionId);
        if (conn) connectionName = conn.name;

        addSession({
          id: sess.id,
          connectionId: sess.connectionId,
          connectionName,
          status: sess.status,
          title: connectionName,
        });
        setActiveSession(sess.id);
        useUIStore.getState().setActiveView('terminal');
        return;
      }
    } catch (err) {
      console.error('Failed to check active sessions:', err);
    }
  }

  if (existing) {
    setActiveSession(existing.id);
    useUIStore.getState().setActiveView('terminal');
    return;
  }

  await spawnSession(connectionId);
}

/** Create a brand-new session for `connectionId` and start connecting it. */
async function spawnSession(connectionId: string): Promise<void> {
  const { addSession, updateSessionStatus } = useTerminalStore.getState();
  const sessionId = uuidv4();

  let connectionName = 'Unknown';
  try {
    const conn = await getApi().connections.get(connectionId);
    if (conn) {
      connectionName = conn.name;
    }
  } catch {
    // Connection lookup may fail if deleted
  }

  addSession({
    id: sessionId,
    connectionId,
    connectionName,
    status: 'connecting',
    title: connectionName,
  });

  try {
    const result = await getApi().ssh.connect({
      connectionId,
      sessionId,
    });

    if (!result.success) {
      toast.error('Connection failed', { description: result.error });
      updateSessionStatus(sessionId, 'error');
    }
  } catch (err: unknown) {
    toast.error(...toastArgs(err, 'Connection error'));
    updateSessionStatus(sessionId, 'error');
  }
}
