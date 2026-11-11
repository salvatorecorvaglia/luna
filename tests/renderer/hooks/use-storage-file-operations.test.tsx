// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorageFileOperations } from '../../../src/renderer/src/hooks/use-storage-file-operations';
import { useStorageStore } from '../../../src/renderer/src/stores/storage-store';
import type { FileEntry } from '../../../src/shared/types/sftp';
import { installFakeApi } from '../../../src/test/fake-api';

const file = (name: string): FileEntry => ({
  name,
  path: `/remote/${name}`,
  size: 10,
  modifiedAt: 0,
  isDirectory: false,
});
const props = () => ({
  activeSessionId: 'session-a' as string | null,
  localPath: '/local',
  remotePath: '/remote',
  invalidateSftp: vi.fn(),
});
function deferred() {
  let resolve!: (value: { content: string; encoding: 'utf-8' }) => void;
  const promise = new Promise<{ content: string; encoding: 'utf-8' }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useStorageStore.setState({ previewFile: null });
});

describe('storage file operations', () => {
  it('keeps the latest preview when local and remote reads finish out of order', async () => {
    const api = installFakeApi();
    const first = deferred();
    api.storage.readFile.mockReturnValueOnce(first.promise);
    api.shell.readFile.mockResolvedValueOnce({ content: 'newer', encoding: 'utf-8', size: 5 });
    const { result } = renderHook(() => useStorageFileOperations(props()));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleRemoteFileOpen(file('old.txt'));
    });
    await act(() => result.current.handleLocalFileOpen(file('new.txt')));
    await act(async () => {
      first.resolve({ content: 'older', encoding: 'utf-8' });
      await pending;
    });
    expect(useStorageStore.getState().previewFile).toMatchObject({
      name: 'new.txt',
      content: 'newer',
      isLocal: true,
    });
  });

  it.each(['session', 'directory', 'unmount'])(
    'discards pending previews after a %s change',
    async (change) => {
      const api = installFakeApi();
      const read = deferred();
      api.storage.readFile.mockReturnValueOnce(read.promise);
      const initialProps = props();
      const { result, rerender, unmount } = renderHook(useStorageFileOperations, { initialProps });
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.handleRemoteFileOpen(file('old.txt'));
      });
      if (change === 'unmount') unmount();
      else
        rerender({
          ...initialProps,
          ...(change === 'session' ? { activeSessionId: 'session-b' } : { remotePath: '/other' }),
        });
      await act(async () => {
        read.resolve({ content: 'stale', encoding: 'utf-8' });
        await pending;
      });
      expect(useStorageStore.getState().previewFile).toBeNull();
    },
  );

  it('rejects traversal names and invalidates the listing after a successful rename', async () => {
    const api = installFakeApi();
    const initialProps = props();
    const { result } = renderHook(() => useStorageFileOperations(initialProps));
    act(() => result.current.handleRemoteRename(file('old.txt')));
    await act(() => result.current.handleRenameConfirm('../escape'));
    expect(api.storage.rename).not.toHaveBeenCalled();
    act(() => result.current.handleRemoteRename(file('old.txt')));
    await act(() => result.current.handleRenameConfirm(' new.txt '));
    expect(api.storage.rename).toHaveBeenCalledWith({
      sessionId: 'session-a',
      oldPath: '/remote/old.txt',
      newPath: '/remote/new.txt',
    });
    expect(initialProps.invalidateSftp).toHaveBeenCalledWith('session-a', '/remote');
  });
});
