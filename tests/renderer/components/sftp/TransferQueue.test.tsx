// @vitest-environment jsdom
import type { TransferItem } from '@shared/types/transfer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferQueue } from '../../../../src/renderer/src/components/sftp/TransferQueue';
import { useTransferStore } from '../../../../src/renderer/src/stores/transfer-store';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function transfer(overrides: Partial<TransferItem> & { id: string }): TransferItem {
  return {
    type: 'download',
    localPath: `/home/me/${overrides.id}.txt`,
    remotePath: `/srv/${overrides.id}.txt`,
    fileName: `${overrides.id}.txt`,
    size: 1000,
    transferred: 250,
    status: 'active',
    bytesPerSec: 100,
    sessionId: 'sess-1',
    ...overrides,
  };
}

function seed(...items: TransferItem[]): void {
  useTransferStore.setState({
    transfers: new Map(items.map((t) => [t.id, t])),
    queueExpanded: true,
  });
}

const ids = () => [...useTransferStore.getState().transfers.keys()];

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
  vi.mocked(toast.error).mockClear();
  useTransferStore.setState({ transfers: new Map(), queueExpanded: false });
});

describe('TransferQueue', () => {
  it('keeps an empty-state hint visible so the queue is discoverable', () => {
    render(<TransferQueue />);
    expect(screen.getByText(/No transfers — drag files between panes/)).toBeInTheDocument();
  });

  it('summarises active and completed transfers', () => {
    seed(
      transfer({ id: 'a' }),
      transfer({ id: 'q', status: 'queued' }),
      transfer({ id: 'c', status: 'completed', transferred: 1000 }),
    );
    render(<TransferQueue />);
    expect(screen.getByText('2 active, 1 completed')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Downloading a.txt' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
  });

  it('removes a cancelled row only once main accepts the cancel', async () => {
    seed(transfer({ id: 'a' }));
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    await waitFor(() => expect(ids()).toEqual([]));
    expect(api.transfers.cancel).toHaveBeenCalledWith('a');
  });

  it('keeps the row when the cancel fails, so the running transfer is not orphaned', async () => {
    seed(transfer({ id: 'a' }));
    api.transfers.cancel.mockRejectedValueOnce(new Error('no such transfer'));
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to cancel transfer'));
    expect(ids()).toEqual(['a']);
  });

  it('removes a finished row without calling main', () => {
    seed(transfer({ id: 'c', status: 'completed', transferred: 1000 }));
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(ids()).toEqual([]);
    expect(api.transfers.cancel).not.toHaveBeenCalled();
  });

  it('asks before cancelling everything, and then cancels only in-flight transfers', async () => {
    seed(
      transfer({ id: 'a' }),
      transfer({ id: 'q', status: 'queued' }),
      transfer({ id: 'c', status: 'completed', transferred: 1000 }),
    );
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel all active transfers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(api.transfers.cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel all active transfers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));

    await waitFor(() => expect(ids()).toEqual(['c']));
    expect(api.transfers.cancel.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'q']);
  });

  it('shows an actionable hint for a classified failure', () => {
    seed(transfer({ id: 'e', status: 'error', error: 'ENOSPC', errorClass: 'disk-full' }));
    render(<TransferQueue />);
    expect(screen.getByText('Disk full — free up space and retry.')).toBeInTheDocument();
  });

  it('replaces a failed row with the retried transfer', async () => {
    seed(transfer({ id: 'e', status: 'error', type: 'upload', error: 'boom' }));
    api.storage.upload.mockResolvedValueOnce('retry-1');
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry transfer' }));

    await waitFor(() => expect(ids()).toEqual(['retry-1']));
    expect(api.storage.upload).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      localPath: '/home/me/e.txt',
      remotePath: '/srv/e.txt',
    });
  });

  it('keeps the failed row when the retry itself fails', async () => {
    seed(transfer({ id: 'e', status: 'error', error: 'boom' }));
    api.storage.download.mockRejectedValueOnce(new Error('session gone'));
    render(<TransferQueue />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry transfer' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(ids()).toEqual(['e']);
  });
});
