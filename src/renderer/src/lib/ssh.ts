import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * Connect to a host by connectionId — creates a new terminal session,
 * adds it to the store, and initiates the SSH connection via IPC.
 */
export async function connectToHost(connectionId: string): Promise<void> {
  const { sessions, addSession, updateSessionStatus, setActiveTab } = useTerminalStore.getState();

  // 1. Check local store
  const existing = Array.from(sessions.values()).find(
    (s) => s.connectionId === connectionId && s.status === 'connected',
  );

  // 2. If not in store, check main process (prevents race after Cmd+R)
  if (!existing) {
    try {
      const { ssh } = await window.api.app.getActiveSessions();
      const sess = ssh.find((s) => s.connectionId === connectionId);
      if (sess) {
        let connectionName = 'SSH';
        const conn = await window.api.connections.get(sess.connectionId);
        if (conn) connectionName = conn.name;

        addSession({
          id: sess.id,
          connectionId: sess.connectionId,
          connectionName,
          status: sess.status,
          title: connectionName,
        });
        setActiveTab(sess.id);
        useUIStore.getState().setActiveView('terminal');
        return;
      }
    } catch (err) {
      console.error('Failed to check active sessions:', err);
    }
  }

  if (existing) {
    setActiveTab(existing.id);
    useUIStore.getState().setActiveView('terminal');
    return;
  }

  const sessionId = uuidv4();

  let connectionName = 'Unknown';
  try {
    const conn = await window.api.connections.get(connectionId);
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
    const result = await window.api.ssh.connect({
      connectionId,
      sessionId,
    });

    if (!result.success) {
      toast.error(`Connection failed: ${result.error}`);
      updateSessionStatus(sessionId, 'error');
    }
  } catch (err: unknown) {
    toast.error(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
    updateSessionStatus(sessionId, 'error');
  }
}
