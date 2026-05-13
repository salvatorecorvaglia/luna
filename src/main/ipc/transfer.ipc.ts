import { IPC } from '@shared/constants';
import { transferQueue } from '../services/transfer-queue';
import { assertNonEmptyString } from '../lib/validate';
import { registerHandler } from '../lib/ipc-handler';

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
