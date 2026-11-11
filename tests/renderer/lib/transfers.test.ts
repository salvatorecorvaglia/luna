import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueTransfer } from '../../../src/renderer/src/lib/transfers';
import { useTransferStore } from '../../../src/renderer/src/stores/transfer-store';
import { installFakeApi } from '../../../src/test/fake-api';

const params = {
  type: 'download' as const,
  sessionId: 'sess',
  localPath: '/local/file',
  remotePath: '/remote/file',
  fileName: 'file',
  size: 100,
};
let api: ReturnType<typeof installFakeApi>;
beforeEach(() => {
  useTransferStore.getState().clearCompleted();
  useTransferStore.setState({ transfers: new Map() });
  api = installFakeApi();
});
describe('transfer registration', () => {
  it.each(['complete', 'error'])(
    'registers the row before an immediate %s event and preserves its terminal status',
    async (outcome) => {
      api.storage.download.mockImplementationOnce(async ({ transferId }) => {
        expect(useTransferStore.getState().transfers.has(transferId)).toBe(true);
        if (outcome === 'complete') useTransferStore.getState().completeTransfer(transferId);
        else useTransferStore.getState().errorTransfer(transferId, 'remote failure');
        return transferId;
      });
      const id = await enqueueTransfer(params);
      expect(useTransferStore.getState().transfers.get(id)?.status).toBe(
        outcome === 'complete' ? 'completed' : 'error',
      );
    },
  );
  it('shares a pending enqueue promise, and preserves progress on later duplicate requests', async () => {
    let finish!: (id: string) => void;
    api.storage.download.mockImplementationOnce(
      ({ transferId }) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(transferId);
        }),
    );
    const first = enqueueTransfer(params);
    const second = enqueueTransfer(params);
    const id = api.storage.download.mock.calls[0]![0].transferId;
    useTransferStore.getState().updateProgress(id, 50, 10);
    finish(id);
    expect(await first).toBe(id);
    expect(await second).toBe(id);
    expect(await enqueueTransfer(params)).toBe(id);
    expect(api.storage.download).toHaveBeenCalledTimes(1);
    expect(useTransferStore.getState().transfers.get(id)).toMatchObject({
      transferred: 50,
      status: 'active',
    });
  });
  it('removes rejected provisional rows and rejects every caller sharing the request', async () => {
    api.storage.download.mockRejectedValueOnce(new Error('queue full'));
    const first = enqueueTransfer(params);
    const second = enqueueTransfer(params);
    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(useTransferStore.getState().transfers.size).toBe(0);
  });
});
