import { IPC } from '@shared/constants';
import { registerHandler } from '../lib/ipc-handler';
import { assertNonEmptyString } from '../lib/validate';
import { transferQueue } from '../services/transfer-queue';

export function registerTransferHandlers(): void {
  registerHandler(IPC.TRANSFER_CANCEL, (_event, transferId: string) => {
    assertNonEmptyString(transferId, 'transferId');
    transferQueue.cancel(transferId);
  });

  registerHandler(IPC.TRANSFER_CANCEL_BY_SESSION, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    transferQueue.cancelBySession(sessionId);
  });
}
