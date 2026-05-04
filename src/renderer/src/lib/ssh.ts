import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useTerminalStore } from '@/stores/terminal-store';

/**
 * Connect to a host by connectionId — creates a new terminal session,
 * adds it to the store, and initiates the SSH connection via IPC.
 */
export async function connectToHost(connectionId: string): Promise<void> {
  const sessionId = uuidv4();
  const { addSession, updateSessionStatus } = useTerminalStore.getState();

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
