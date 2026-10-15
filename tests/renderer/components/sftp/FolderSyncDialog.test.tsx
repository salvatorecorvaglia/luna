// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderSyncDialog } from '../../../../src/renderer/src/components/sftp/FolderSyncDialog';
import { useTransferStore } from '../../../../src/renderer/src/stores/transfer-store';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const DIFF_RESULT = {
  items: [
    {
      relativePath: 'a.txt',
      localSize: 10,
      remoteSize: 5,
      status: 'modified',
      recommendedAction: 'upload',
    },
  ],
  onlyLocalCount: 1,
  onlyRemoteCount: 0,
  modifiedCount: 1,
  identicalCount: 0,
};

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
});

function renderDialog(open = true) {
  return render(
    <FolderSyncDialog
      open={open}
      onClose={vi.fn()}
      localPath="/local/dir"
      remotePath="/remote/dir"
      sessionId="s1"
    />,
  );
}

describe('FolderSyncDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog(false);
    expect(screen.queryByText('Differential Folder Synchronizer')).toBeNull();
  });

  it('runs a comparison on open and shows the diff table', async () => {
    (api.storage.compareDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(DIFF_RESULT);
    renderDialog();
    await screen.findByText('a.txt');
    expect(api.shell.readdir).toHaveBeenCalledWith('/local/dir');
    expect(api.storage.list).toHaveBeenCalledWith({ sessionId: 's1', path: '/remote/dir' });
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('shows an empty state when there are no differences', async () => {
    renderDialog();
    await screen.findByText('No files found in specified directories.');
  });

  it('re-runs the comparison on demand', async () => {
    renderDialog();
    await screen.findByText('No files found in specified directories.');
    (api.storage.compareDirectories as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Re-Compare/ }));

    await vi.waitFor(() => expect(api.storage.compareDirectories).toHaveBeenCalledTimes(1));
  });

  it('executes the sync for each recommended item and closes on full success', async () => {
    (api.storage.compareDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(DIFF_RESULT);
    const onClose = vi.fn();
    render(
      <FolderSyncDialog
        open
        onClose={onClose}
        localPath="/local/dir"
        remotePath="/remote/dir"
        sessionId="s1"
      />,
    );
    await screen.findByText('a.txt');

    fireEvent.click(screen.getByRole('button', { name: /Execute Sync/ }));

    await vi.waitFor(() =>
      expect(api.storage.upload).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1', remotePath: '/remote/dir/a.txt' }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <FolderSyncDialog
        open
        onClose={onClose}
        localPath="/local/dir"
        remotePath="/remote/dir"
        sessionId="s1"
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('registers each queued sync transfer in the transfer queue', async () => {
    // Regression: the dialog called storage.upload/download and discarded the
    // returned id, so progress/complete events were dropped and the sync ran
    // invisibly and uncancellably.
    useTransferStore.setState({ transfers: new Map() });
    (api.storage.compareDirectories as ReturnType<typeof vi.fn>).mockResolvedValue(DIFF_RESULT);
    (api.storage.upload as ReturnType<typeof vi.fn>).mockResolvedValue('t-42');
    renderDialog();
    await screen.findByText('a.txt');

    fireEvent.click(screen.getByRole('button', { name: /Execute Sync/ }));

    await vi.waitFor(() => expect(useTransferStore.getState().transfers.has('t-42')).toBe(true));
    expect(useTransferStore.getState().transfers.get('t-42')).toMatchObject({
      type: 'upload',
      fileName: 'a.txt',
      size: 10,
      sessionId: 's1',
      status: 'queued',
    });
  });

  it('never shows or executes a comparison that a newer one superseded', async () => {
    // Regression: switching direction re-ran the comparison with no request
    // token. The older response could land last, and Execute stayed enabled
    // while loading — so the previous direction's diff could be executed.
    let resolveFirst!: (v: typeof DIFF_RESULT) => void;
    const compare = api.storage.compareDirectories as ReturnType<typeof vi.fn>;
    compare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    let resolveSecond!: (v: typeof DIFF_RESULT) => void;
    compare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    renderDialog();
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sync-to-local' } });
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /Execute Sync/ })).toBeDisabled();

    // The stale (upload) diff resolves after the newer request was issued.
    resolveFirst(DIFF_RESULT);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('a.txt')).toBeNull();
    expect(screen.getByRole('button', { name: /Execute Sync/ })).toBeDisabled();

    resolveSecond({
      ...DIFF_RESULT,
      items: [{ ...DIFF_RESULT.items[0]!, relativePath: 'b.txt', recommendedAction: 'download' }],
    });
    await screen.findByText('b.txt');
  });
});
