// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderSyncDialog } from '../../../../src/renderer/src/components/sftp/FolderSyncDialog';
import { useTransferStore } from '../../../../src/renderer/src/stores/transfer-store';
import { installFakeApi } from '../../../../src/test/fake-api';

// jsdom has no layout; keep a bounded viewport instead of rendering every row.
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 12) }, (_, index) => ({
        index,
        key: index,
        start: 40 + index * 52,
        size: 52,
      })),
    getTotalSize: () => count * 52,
    scrollToIndex: vi.fn(),
  }),
}));

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
  useTransferStore.getState().clearCompleted();
  useTransferStore.setState({ transfers: new Map() });
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
    renderDialog();
    await screen.findByText('a.txt');

    fireEvent.click(screen.getByRole('button', { name: /Execute Sync/ }));

    await vi.waitFor(() => expect(api.storage.upload).toHaveBeenCalled());
    const id = api.storage.upload.mock.calls[0]![0].transferId;
    expect(useTransferStore.getState().transfers.get(id)).toMatchObject({
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

    fireEvent.change(screen.getByRole('combobox', { name: 'Sync rule:' }), {
      target: { value: 'sync-to-local' },
    });
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

describe('sync decisions and execution', () => {
  function show(items: typeof DIFF_RESULT.items) {
    api.storage.compareDirectories.mockResolvedValue({ ...DIFF_RESULT, items } as Awaited<
      ReturnType<typeof api.storage.compareDirectories>
    >);
    const onClose = vi.fn();
    const rendered = render(
      <FolderSyncDialog
        open
        onClose={onClose}
        localPath="/local/dir"
        remotePath="/remote/dir"
        sessionId="s1"
      />,
    );
    return { onClose, ...rendered };
  }
  const conflict = (path: string) => ({
    ...DIFF_RESULT.items[0]!,
    relativePath: path,
    recommendedAction: 'conflict',
  });
  it('blocks execution until every conflict is explicitly resolved, including skip', async () => {
    const { onClose } = show([conflict('one.txt'), conflict('two.txt')]);
    await screen.findByText('one.txt');
    const execute = screen.getByRole('button', { name: 'Execute Sync' });
    expect(execute).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('2 unresolved');
    fireEvent.change(screen.getByLabelText('Resolve conflict for one.txt'), {
      target: { value: 'upload' },
    });
    expect(execute).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Resolve conflict for two.txt'), {
      target: { value: 'skip' },
    });
    expect(execute).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('1 transfer(s) ready; 0 unresolved');
    fireEvent.click(execute);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.storage.upload).toHaveBeenCalledTimes(1);
    expect(api.storage.download).not.toHaveBeenCalled();
  });
  it('queues the chosen download rather than assuming upload for a conflict', async () => {
    const { onClose } = show([conflict('one.txt')]);
    await screen.findByText('one.txt');
    fireEvent.change(screen.getByLabelText('Resolve conflict for one.txt'), {
      target: { value: 'download' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Execute Sync' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.storage.download).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: '/remote/dir/one.txt' }),
    );
    expect(api.storage.upload).not.toHaveBeenCalled();
  });
  it('never reports a conflict-only skip as a successful zero-transfer sync', async () => {
    const { onClose } = show([conflict('one.txt')]);
    await screen.findByText('one.txt');
    fireEvent.change(screen.getByLabelText('Resolve conflict for one.txt'), {
      target: { value: 'skip' },
    });
    expect(screen.getByRole('button', { name: 'Execute Sync' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('keeps partial failures open and retries only files that were not queued', async () => {
    const { onClose } = show([
      { ...DIFF_RESULT.items[0]!, relativePath: 'one.txt' },
      { ...DIFF_RESULT.items[0]!, relativePath: 'two.txt' },
    ]);
    api.storage.upload
      .mockImplementationOnce(async (p) => p.transferId)
      .mockRejectedValueOnce(new Error('queue full'));
    await screen.findByText('one.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Execute Sync' }));
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Execute Sync' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.storage.upload.mock.calls.map(([p]) => p.remotePath)).toEqual([
      '/remote/dir/one.txt',
      '/remote/dir/two.txt',
      '/remote/dir/two.txt',
    ]);
  });
  it('stops submitting new files when Stop queueing is pressed', async () => {
    const { onClose } = show([
      { ...DIFF_RESULT.items[0]!, relativePath: 'one.txt' },
      { ...DIFF_RESULT.items[0]!, relativePath: 'two.txt' },
    ]);
    let finishJoin!: (path: string) => void;
    api.shell.joinPath
      .mockImplementationOnce(async (_base, file) => `/local/dir/${file}`)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishJoin = resolve;
          }),
      );
    await screen.findByText('one.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Execute Sync' }));
    await vi.waitFor(() => expect(api.shell.joinPath).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Stop queueing' }));
    await act(async () => finishJoin('/local/dir/two.txt'));
    expect(api.storage.upload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useTransferStore.getState().transfers.size).toBe(1);
  });
  it('reports a comparison failure instead of claiming the directories are empty', async () => {
    api.storage.compareDirectories.mockRejectedValueOnce(new Error('session closed'));
    renderDialog();
    await screen.findByText('Comparison failed');
    expect(screen.getByText('session closed')).toBeInTheDocument();
    expect(screen.queryByText('No files found in specified directories.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute Sync' })).toBeDisabled();
  });

  it('resets conflict choices after re-comparison', async () => {
    show([conflict('one.txt')]);
    await screen.findByText('one.txt');
    fireEvent.change(screen.getByLabelText('Resolve conflict for one.txt'), {
      target: { value: 'upload' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Re-Compare' }));
    await vi.waitFor(() => expect(api.storage.compareDirectories).toHaveBeenCalledTimes(2));
    await screen.findByText('one.txt');
    expect(screen.getByLabelText('Resolve conflict for one.txt')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Execute Sync' })).toBeDisabled();
  });
  it('renders bounded rows for large comparisons and preserves the total row count', async () => {
    show(
      Array.from({ length: 10000 }, (_, index) => ({
        ...DIFF_RESULT.items[0]!,
        relativePath: `file-${index}.txt`,
      })),
    );
    const table = await screen.findByRole('table', { name: 'Folder comparison' });
    expect(table).toHaveAttribute('aria-rowcount', '10001');
    expect(screen.getAllByRole('row').length).toBeLessThan(30);
    expect(screen.getByText(/File contents are not compared/)).toBeInTheDocument();
    expect(screen.queryByText('Identical')).not.toBeInTheDocument();
  });
  it('invalidates a pending comparison on close and ignores its late result', async () => {
    let finish!: (value: typeof DIFF_RESULT) => void;
    api.storage.compareDirectories.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish;
        }),
    );
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
    await vi.waitFor(() => expect(api.storage.compareDirectories).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => finish(DIFF_RESULT));
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
