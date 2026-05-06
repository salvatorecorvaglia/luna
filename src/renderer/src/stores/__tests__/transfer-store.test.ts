import { beforeEach, describe, expect, it } from 'vitest';
import { useTransferStore } from '../transfer-store';
import type { TransferItem } from '@shared/types/transfer';

function makeTransfer(overrides: Partial<TransferItem> = {}): TransferItem {
  return {
    id: 'test-1',
    type: 'download',
    localPath: '/tmp/file.txt',
    remotePath: '/home/user/file.txt',
    fileName: 'file.txt',
    size: 1024,
    transferred: 0,
    status: 'queued',
    bytesPerSec: 0,
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('transfer-store', () => {
  beforeEach(() => {
    // Reset store state fully
    useTransferStore.setState({
      transfers: new Map(),
      queueExpanded: false,
    });
  });

  it('adds a transfer and expands queue', () => {
    const transfer = makeTransfer();
    useTransferStore.getState().addTransfer(transfer);

    const state = useTransferStore.getState();
    expect(state.transfers.size).toBe(1);
    expect(state.transfers.get('test-1')).toEqual(transfer);
    expect(state.queueExpanded).toBe(true);
  });

  it('updates progress', () => {
    useTransferStore.getState().addTransfer(makeTransfer());
    useTransferStore.getState().updateProgress('test-1', 512, 100);

    const item = useTransferStore.getState().transfers.get('test-1')!;
    expect(item.transferred).toBe(512);
    expect(item.bytesPerSec).toBe(100);
    expect(item.status).toBe('active');
  });

  it('completes a transfer', () => {
    useTransferStore.getState().addTransfer(makeTransfer());
    useTransferStore.getState().completeTransfer('test-1');

    const item = useTransferStore.getState().transfers.get('test-1')!;
    expect(item.status).toBe('completed');
    expect(item.transferred).toBe(1024); // matches size
  });

  it('errors a transfer', () => {
    useTransferStore.getState().addTransfer(makeTransfer());
    useTransferStore.getState().errorTransfer('test-1', 'Connection lost');

    const item = useTransferStore.getState().transfers.get('test-1')!;
    expect(item.status).toBe('error');
    expect(item.error).toBe('Connection lost');
  });

  it('removes a transfer', () => {
    useTransferStore.getState().addTransfer(makeTransfer());
    useTransferStore.getState().removeTransfer('test-1');

    expect(useTransferStore.getState().transfers.size).toBe(0);
  });

  it('clears completed and errored transfers', () => {
    useTransferStore.getState().addTransfer(makeTransfer({ id: 'a', status: 'completed' }));
    useTransferStore.getState().addTransfer(makeTransfer({ id: 'b', status: 'error' }));
    useTransferStore.getState().addTransfer(makeTransfer({ id: 'c', status: 'active' }));

    useTransferStore.getState().clearCompleted();

    const state = useTransferStore.getState();
    expect(state.transfers.size).toBe(1);
    expect(state.transfers.has('c')).toBe(true);
  });

  describe('applyProgressBatch terminal-status guard', () => {
    it('ignores progress samples for completed transfers', () => {
      useTransferStore.getState().addTransfer(makeTransfer({ id: 'a' }));
      useTransferStore.getState().completeTransfer('a');

      // A late progress event arrives after completion — must be ignored
      // so the row doesn't revert to "active" and stay in the in-flight UI.
      useTransferStore
        .getState()
        .applyProgressBatch([{ transferId: 'a', transferred: 256, bytesPerSec: 50 }]);

      const item = useTransferStore.getState().transfers.get('a')!;
      expect(item.status).toBe('completed');
      // transferred stays at the completed value (size), not the stale sample.
      expect(item.transferred).toBe(1024);
    });

    it('ignores progress for errored transfers', () => {
      useTransferStore.getState().addTransfer(makeTransfer({ id: 'b' }));
      useTransferStore.getState().errorTransfer('b', 'boom');

      useTransferStore
        .getState()
        .applyProgressBatch([{ transferId: 'b', transferred: 999, bytesPerSec: 1 }]);

      expect(useTransferStore.getState().transfers.get('b')!.status).toBe('error');
    });

    it('still applies progress to active transfers', () => {
      useTransferStore.getState().addTransfer(makeTransfer({ id: 'c', status: 'active' }));
      useTransferStore
        .getState()
        .applyProgressBatch([{ transferId: 'c', transferred: 512, bytesPerSec: 100 }]);

      const item = useTransferStore.getState().transfers.get('c')!;
      expect(item.transferred).toBe(512);
      expect(item.bytesPerSec).toBe(100);
    });
  });

  it('toggles queue expanded', () => {
    expect(useTransferStore.getState().queueExpanded).toBe(false);
    useTransferStore.getState().toggleQueueExpanded();
    expect(useTransferStore.getState().queueExpanded).toBe(true);
    useTransferStore.getState().toggleQueueExpanded();
    expect(useTransferStore.getState().queueExpanded).toBe(false);
  });
});
