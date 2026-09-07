import { useEffect } from 'react';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';

/**
 * Keeps every SSH session's status in sync with the main process.
 *
 * This listener used to live in `TerminalPane`, registered from the terminal's
 * `onReady` callback — i.e. only after xterm had finished loading and mounting.
 * On a first connect (cold module load, no warm cache) the handshake often won
 * that race, so the `connected` event fired before anyone was listening and the
 * session stayed stuck on "connecting" — spinner in the tab, CONNECTING in the
 * status bar — even though the shell was already usable. Reconnecting later
 * looked fine only because the second pane mounted fast enough to win.
 *
 * Registering once at app startup removes the race entirely: the subscription
 * exists long before any session is created, and it covers split panes and
 * sessions recovered after a reload for free.
 */
export function useSshStatusListener(): void {
  useEffect(() => {
    return getApi().ssh.onStatus((event) => {
      useTerminalStore.getState().updateSessionStatus(event.sessionId, event.status);
    });
  }, []);
}
