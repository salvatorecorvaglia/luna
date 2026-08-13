import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transferQueue } from '../../../src/main/services/transfer-queue';
import { registerTransferHandlers } from '../../../src/main/ipc/transfer.ipc';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../../src/main/services/transfer-queue', () => ({
  transferQueue: {
    cancel: vi.fn(),
    cancelBySession: vi.fn(),
  },
}));

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerTransferHandlers();
});

describe('transfer IPC', () => {
  it('transfer:cancel rejects empty transferId', async () => {
    await expect(handlers.get(IPC.TRANSFER_CANCEL)!({}, '')).rejects.toThrow(/transferId/);
  });

  it('transfer:cancel forwards transferId to queue', async () => {
    await handlers.get(IPC.TRANSFER_CANCEL)!({}, 't1');
    expect(transferQueue.cancel).toHaveBeenCalledWith('t1');
  });

  it('transfer:cancel-by-session rejects empty sessionId', async () => {
    await expect(handlers.get(IPC.TRANSFER_CANCEL_BY_SESSION)!({}, '')).rejects.toThrow(
      /sessionId/,
    );
  });

  it('transfer:cancel-by-session forwards sessionId to queue', async () => {
    await handlers.get(IPC.TRANSFER_CANCEL_BY_SESSION)!({}, 's1');
    expect(transferQueue.cancelBySession).toHaveBeenCalledWith('s1');
  });
});
