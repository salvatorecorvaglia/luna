import type { StorageSession } from '@/stores/storage-store';
import type { TerminalSession } from '@/stores/terminal-store';

/**
 * Resolve which session id the SFTP pane should attach to, given the
 * current set of SSH/storage sessions and which connection is active.
 *
 * Priority:
 *   1. A connected SSH session for the active connection.
 *   2. If an SSH session for the active connection is *connecting* or
 *      *reconnecting*, return null and wait — don't silently swap to
 *      an unrelated S3 session and confuse the user with the wrong
 *      remote tree.
 *   3. A connected S3 session for the active connection.
 *   4. If no `currentSftpSessionId` is set, fall back to the first
 *      connected SSH session, then the first connected S3 session.
 *
 * Returns null when no session should be auto-selected (either nothing
 * is connected or the user already has a valid pick).
 */
export function resolveSftpSession(
  sessions: Map<string, TerminalSession>,
  storageSessions: Map<string, StorageSession>,
  activeConnectionId: string | null,
  currentSftpSessionId: string | null,
): string | null {
  if (activeConnectionId) {
    for (const s of sessions.values()) {
      if (
        s.connectionId === activeConnectionId &&
        s.status === 'connected' &&
        (!s.type || s.type === 'ssh')
      ) {
        return s.id;
      }
    }
    const sshConnecting = Array.from(sessions.values()).some(
      (s) =>
        s.connectionId === activeConnectionId &&
        (s.status === 'connecting' || s.status === 'reconnecting') &&
        (!s.type || s.type === 'ssh'),
    );
    if (!sshConnecting) {
      for (const s of storageSessions.values()) {
        if (s.connectionId === activeConnectionId && s.status === 'connected') {
          return s.id;
        }
      }
    } else {
      return null;
    }
  }

  if (!currentSftpSessionId) {
    for (const s of sessions.values()) {
      if (s.status === 'connected' && (!s.type || s.type === 'ssh')) {
        return s.id;
      }
    }
    for (const s of storageSessions.values()) {
      if (s.status === 'connected') {
        return s.id;
      }
    }
  }

  return null;
}
