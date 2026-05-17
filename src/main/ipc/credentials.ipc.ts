import { IPC } from '@shared/constants';
import {
  deleteCredential,
  onCredentialTamper,
  retrieveCredential,
  storeCredential,
} from '../services/credential-store';
import { getMainWindow } from './app.ipc';
import { assertNonEmptyString } from '../lib/validate';
import { registerHandler } from '../lib/ipc-handler';
import { ErrorCode, LunarError } from '@shared/errors';

/**
 * Sliding-window rate limit on credential retrievals so a compromised renderer
 * can't enumerate connectionIds. A legitimate flow only retrieves on connect
 * (a handful per minute). The fixed-window variant of this check let bursts at
 * the window boundary slip through; the sliding window keeps the cap honest.
 */
const RETRIEVE_WINDOW_MS = 60_000;
const RETRIEVE_MAX_PER_WINDOW = 60;
// Ring buffer over the window: O(1) per check, no per-call array mutation.
// head/tail are monotonically increasing counters; size = tail - head.
const retrieveTimestamps: number[] = new Array(RETRIEVE_MAX_PER_WINDOW);
let retrieveHead = 0;
let retrieveTail = 0;

function checkRetrieveRate(): void {
  const now = Date.now();
  const cutoff = now - RETRIEVE_WINDOW_MS;
  while (
    retrieveHead < retrieveTail &&
    retrieveTimestamps[retrieveHead % RETRIEVE_MAX_PER_WINDOW] < cutoff
  ) {
    retrieveHead++;
  }
  if (retrieveTail - retrieveHead >= RETRIEVE_MAX_PER_WINDOW) {
    throw new LunarError('Credential retrieval rate limit exceeded', ErrorCode.FORBIDDEN);
  }
  retrieveTimestamps[retrieveTail % RETRIEVE_MAX_PER_WINDOW] = now;
  retrieveTail++;
}

/** Cap on the size of a secret accepted from the renderer (bytes, UTF-8). */
const MAX_CREDENTIAL_SECRET_BYTES = 65536;

export function registerCredentialHandlers(): void {
  // Forward decrypt-failure events to the renderer so it can surface a
  // security banner. The renderer subscribes via window.api.credentials.onTamper.
  onCredentialTamper((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.CREDENTIAL_ON_TAMPER, event);
    }
  });

  registerHandler(
    IPC.CREDENTIAL_STORE,
    (_event, payload: { connectionId: string; secret: string }) => {
      assertNonEmptyString(payload?.connectionId, 'connectionId');
      assertNonEmptyString(payload?.secret, 'secret');
      if (Buffer.byteLength(payload.secret, 'utf-8') > MAX_CREDENTIAL_SECRET_BYTES) {
        throw new LunarError(
          `secret exceeds ${MAX_CREDENTIAL_SECRET_BYTES}-byte cap`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      storeCredential(payload.connectionId, payload.secret);
    },
  );

  registerHandler(IPC.CREDENTIAL_RETRIEVE, (_event, connectionId: string) => {
    checkRetrieveRate();
    assertNonEmptyString(connectionId, 'connectionId');
    return retrieveCredential(connectionId);
  });

  registerHandler(IPC.CREDENTIAL_DELETE, (_event, connectionId: string) => {
    assertNonEmptyString(connectionId, 'connectionId');
    deleteCredential(connectionId);
  });
}
