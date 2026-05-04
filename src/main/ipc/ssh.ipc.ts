import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import { sshManager } from '../services/ssh-manager';
import { assertBoundedInt, assertNonEmptyString } from '../lib/validate';
import type { SshConnectParams, SshResizeParams, SshSendDataParams } from '@shared/types/terminal';

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

  ipcMain.handle(IPC.SSH_TEST_CONNECTION, async (_event, params: { connectionId: string }) => {
    assertNonEmptyString(params.connectionId, 'connectionId');
    return sshManager.testConnection(params.connectionId);
  });

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
