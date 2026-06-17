import { useEffect } from 'react';
import { useStorageStore } from '@/stores/storage-store';
import { useTerminalStore } from '@/stores/terminal-store';

/**
 * Syncs the renderer stores with the active sessions in the main process.
 * This allows the app to recover its state after a page reload (Cmd+R).
 */
export function useSessionRecovery() {
  useEffect(() => {
    // StrictMode runs effects twice in development, and a fast unmount/remount
    // could otherwise let two recover() promises race writes to the stores.
    // `cancelled` short-circuits state mutations after teardown.
    let cancelled = false;
    const recover = async () => {
      try {
        const { ssh, s3 } = await window.api.app.getActiveSessions();
        if (cancelled) return;

        // Recover SSH sessions (Terminal)
        const sshSessionIds = new Set(ssh.map((s) => s.id));

        for (const sess of ssh) {
          if (cancelled) return;
          const existing = useTerminalStore.getState().sessions.get(sess.id);
          if (!existing) {
            let connectionName = 'SSH';
            try {
              const conn = await window.api.connections.get(sess.connectionId);
              if (conn) connectionName = conn.name;
            } catch {
              // ignore
            }
            if (cancelled) return;

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
        const s3SessionIds = new Set(s3.map((s) => s.id));

        for (const sess of s3) {
          const existing = useStorageStore.getState().storageSessions.get(sess.id);
          if (!existing) {
            useStorageStore.getState().addStorageSession({
              id: sess.id,
              connectionId: sess.connectionId,
              connectionName: sess.connectionName,
              provider: 's3',
              status: 'connected',
              initialPath: sess.initialPath,
            });
          }
        }

        // Cleanup: Clear activeSessionId if it's no longer valid
        const currentSftpSessionId = useStorageStore.getState().activeSessionId;
        if (
          currentSftpSessionId &&
          !sshSessionIds.has(currentSftpSessionId) &&
          !s3SessionIds.has(currentSftpSessionId)
        ) {
          useStorageStore.getState().setActiveSessionId(null);
        }
      } catch (err) {
        console.error('Failed to recover sessions:', err);
      }
    };

    void recover();
    return () => {
      cancelled = true;
    };
  }, []);
}
