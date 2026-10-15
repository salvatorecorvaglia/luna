import { IPC } from '@shared/constants';
import { onCredentialTamper } from '../services/credential-store';
import { getMainWindow } from './app.ipc';

/**
 * The renderer's only view of the credential store: tamper notifications.
 *
 * There used to be invoke channels for store/retrieve/delete and for resolving
 * 1Password/Bitwarden references. No renderer code called any of them — main
 * reads a connection's secret itself at connect time (ssh-config.ts,
 * s3-provider) and writes it inside connection create/update — so they were
 * pure attack surface, and `credential:retrieve` in particular handed a
 * compromised renderer every saved password in plaintext, rate limit or not.
 * Keep secrets on this side of the bridge: if a future feature needs one in
 * the renderer, it should get a purpose-built channel, not a general reader.
 */
export function registerCredentialHandlers(): void {
  // Forward decrypt-failure events to the renderer so it can surface a
  // security banner. The renderer subscribes via window.api.credentials.onTamper.
  onCredentialTamper((event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.CREDENTIAL_ON_TAMPER, event);
    }
  });
}
