import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import { sshManager } from '../services/ssh-manager';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';

const VALID_AUTH_TYPES = new Set(['password', 'key', 'key+passphrase']);
/** Cap on the size of a single transient secret accepted from the renderer. */
const MAX_SECRET_LEN = 4096;
import type { SshConnectParams, SshResizeParams, SshSendDataParams } from '@shared/types/terminal';
import type { AuthType } from '@shared/types/connection';

export function registerSshHandlers(): void {
  ipcMain.handle(IPC.SSH_CONNECT, async (_event, params: SshConnectParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertNonEmptyString(params.connectionId, 'connectionId');
    return sshManager.connect(params.sessionId, params.connectionId, params.cols, params.rows);
  });

  ipcMain.handle(IPC.SSH_DISCONNECT, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    sshManager.disconnect(sessionId);
  });

  ipcMain.handle(IPC.SSH_SEND_DATA, (_event, params: SshSendDataParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    sshManager.sendData(params.sessionId, params.data);
  });

  ipcMain.handle(
    IPC.SSH_TEST_CONNECTION,
    async (
      _event,
      params: {
        connectionId?: string;
        config?: {
          host: string;
          port: number;
          username: string;
          authType: AuthType;
          privateKeyPath?: string;
          password?: string;
          passphrase?: string;
        };
      },
    ) => {
      // Never accept transient secrets alongside a saved connectionId —
      // forces the renderer to choose one path explicitly so password material
      // can't be silently injected into a flow that should use stored creds.
      if (params.connectionId && params.config) {
        throw new Error('testConnection accepts either connectionId or config, not both');
      }
      if (params.config) {
        const c = params.config;
        assertNonEmptyString(c.host, 'host');
        assertBoundedInt(c.port, 'port', 1, 65535);
        assertNonEmptyString(c.username, 'username');
        if (!VALID_AUTH_TYPES.has(c.authType)) {
          throw new Error(`Unsupported authType "${c.authType}"`);
        }
        for (const [k, v] of Object.entries({ password: c.password, passphrase: c.passphrase })) {
          if (v === undefined) continue;
          if (typeof v !== 'string' || v.length > MAX_SECRET_LEN) {
            throw new Error(`${k} must be a string up to ${MAX_SECRET_LEN} characters`);
          }
        }
      } else if (params.connectionId) {
        assertNonEmptyString(params.connectionId, 'connectionId');
      } else {
        throw new Error('testConnection requires connectionId or config');
      }
      return sshManager.testConnection(params);
    },
  );

  ipcMain.handle(IPC.SSH_RESIZE, (_event, params: SshResizeParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertBoundedInt(params.cols, 'cols', 1, 500);
    assertBoundedInt(params.rows, 'rows', 1, 500);
    sshManager.resize(params.sessionId, params.cols, params.rows);
  });

  ipcMain.handle(
    IPC.SSH_TRUST_HOST_KEY,
    (
      _event,
      params: { host: string; port: number },
    ): { trusted: boolean; fingerprint?: string } => {
      assertNonEmptyString(params.host, 'host');
      assertBoundedInt(params.port, 'port', 1, 65535);
      const fp = sshManager.trustPendingHostKey(params.host, params.port);
      return fp ? { trusted: true, fingerprint: fp } : { trusted: false };
    },
  );
}
