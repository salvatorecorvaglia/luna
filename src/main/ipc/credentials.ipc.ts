import { IPC } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import { registerHandler } from '../lib/ipc-handler';
import { SlidingWindowLimiter } from '../lib/sliding-window-limiter';
import { assertNonEmptyString } from '../lib/validate';
import {
  deleteCredential,
  onCredentialTamper,
  retrieveCredential,
  storeCredential,
} from '../services/credential-store';
import { passwordManagerService } from '../services/password-manager-service';
import { getMainWindow } from './app.ipc';

/**
 * Sliding-window rate limit on credential retrievals so a compromised renderer
 * can't enumerate connectionIds. A legitimate flow only retrieves on connect
 * (a handful per minute).
 */
const retrieveLimiter = new SlidingWindowLimiter(60, 60_000, 'Credential retrieval');

/**
 * External-secret resolution is rate-limited far more aggressively than local
 * retrieval, and for a different reason. `credential:retrieve` can only reach
 * Luna's own encrypted store; `credential:resolve-external` shells out to the
 * user's password-manager CLI, which is typically unlocked for their *entire*
 * vault. Without a limit, a compromised renderer could walk every secret the
 * `op`/`bw` session can reach. Ten per minute is far above any interactive
 * use (one per connect) and far below what enumeration needs.
 */
const externalLimiter = new SlidingWindowLimiter(10, 60_000, 'External secret resolution');

/** Test-only: reset both limiters between cases. */
export function __resetCredentialRateLimiters(): void {
  retrieveLimiter.reset();
  externalLimiter.reset();
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
        throw new LunaError(
          `secret exceeds ${MAX_CREDENTIAL_SECRET_BYTES}-byte cap`,
          ErrorCode.VALIDATION_ERROR,
        );
      }
      storeCredential(payload.connectionId, payload.secret);
    },
  );

  registerHandler(IPC.CREDENTIAL_RETRIEVE, (_event, connectionId: string) => {
    retrieveLimiter.check();
    assertNonEmptyString(connectionId, 'connectionId');
    return retrieveCredential(connectionId);
  });

  registerHandler(IPC.CREDENTIAL_DELETE, (_event, connectionId: string) => {
    assertNonEmptyString(connectionId, 'connectionId');
    deleteCredential(connectionId);
  });

  registerHandler(IPC.CREDENTIAL_RESOLVE_EXTERNAL, (_event, ref: string) => {
    externalLimiter.check();
    assertNonEmptyString(ref, 'ref');
    return passwordManagerService.resolveSecretReference(ref);
  });
}
