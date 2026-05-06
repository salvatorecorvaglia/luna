import { useEffect } from 'react';
import { useTerminalStore } from '@/stores/terminal-store';
import { useSftpStore } from '@/stores/sftp-store';

/**
 * Syncs the renderer stores with the active sessions in the main process.
 * This allows the app to recover its state after a page reload (Cmd+R).
 */
export function useSessionRecovery() {
  useEffect(() => {
    const recover = async () => {
      try {
        const { ssh, s3 } = await window.api.app.getActiveSessions();

        // Recover SSH sessions (Terminal)
        for (const sess of ssh) {
          const existing = useTerminalStore.getState().sessions.get(sess.id);
          if (!existing) {
            let connectionName = 'SSH';
            try {
              const conn = await window.api.connections.get(sess.connectionId);
              if (conn) connectionName = conn.name;
            } catch {
              // ignore
            }

            useTerminalStore.getState().addSession({
              id: sess.id,
              connectionId: sess.connectionId,
              connectionName,
              status: sess.status,
              title: connectionName,
            });
          }
        }

        // Recover S3 sessions
        for (const sess of s3) {
          const existing = useSftpStore.getState().storageSessions.get(sess.id);
          if (!existing) {
            useSftpStore.getState().addStorageSession({
              id: sess.id,
              connectionId: sess.connectionId,
              connectionName: sess.connectionName,
              provider: 's3',
              status: 'connected',
              initialPath: sess.initialPath,
            });
          }
        }
      } catch (err) {
        console.error('Failed to recover sessions:', err);
      }
    };

    recover();
  }, []);
}
