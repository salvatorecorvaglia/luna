import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import {
  deleteCredential,
  retrieveCredential,
  storeCredential,
} from '../services/credential-store';
import { assertNonEmptyString } from '../lib/validate';

/**
 * Sliding-window rate limit on credential retrievals so a compromised renderer
 * can't enumerate connectionIds. A legitimate flow only retrieves on connect
 * (a handful per minute). The fixed-window variant of this check let bursts at
 * the window boundary slip through; the sliding window keeps the cap honest.
 */
const RETRIEVE_WINDOW_MS = 60_000;
const RETRIEVE_MAX_PER_WINDOW = 60;
const retrieveTimestamps: number[] = [];

function checkRetrieveRate(): void {
  const now = Date.now();
  const cutoff = now - RETRIEVE_WINDOW_MS;
  while (retrieveTimestamps.length > 0 && retrieveTimestamps[0] < cutoff) {
    retrieveTimestamps.shift();
  }
  if (retrieveTimestamps.length >= RETRIEVE_MAX_PER_WINDOW) {
    throw new Error('Credential retrieval rate limit exceeded');
  }
  retrieveTimestamps.push(now);
}

export function registerCredentialHandlers(): void {
  // Validation errors are the validators doing their job — they propagate to
  // the renderer naturally as a rejected invoke(). Don't log them: it floods
  // the file with normal-path noise (tests + transient bad payloads).
  ipcMain.handle(
    IPC.CREDENTIAL_STORE,
    (_event, payload: { connectionId: string; secret: string }) => {
      assertNonEmptyString(payload?.connectionId, 'connectionId');
      assertNonEmptyString(payload?.secret, 'secret');
      storeCredential(payload.connectionId, payload.secret);
    },
  );

  ipcMain.handle(IPC.CREDENTIAL_RETRIEVE, (_event, connectionId: string) => {
    checkRetrieveRate();
    assertNonEmptyString(connectionId, 'connectionId');
    return retrieveCredential(connectionId);
  });

  ipcMain.handle(IPC.CREDENTIAL_DELETE, (_event, connectionId: string) => {
    assertNonEmptyString(connectionId, 'connectionId');
    deleteCredential(connectionId);
  });
}
