// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStorageStore } from '../storage-store';

describe('storage-store', () => {
  beforeEach(() => {
    useStorageStore.setState({
      localPath: '',
      remotePath: '/',
      localSelection: new Set(),
      remoteSelection: new Set(),
      showHiddenFiles: false,
      previewFile: null,
      activeSessionId: null,
    });
  });

  it('sets local path and clears selection', () => {
    useStorageStore.getState().toggleLocalSelection('file.txt');
    expect(useStorageStore.getState().localSelection.size).toBe(1);

    useStorageStore.getState().setLocalPath('/tmp');
    expect(useStorageStore.getState().localPath).toBe('/tmp');
    expect(useStorageStore.getState().localSelection.size).toBe(0);
  });

  it('sets remote path and clears selection', () => {
    useStorageStore.getState().toggleRemoteSelection('file.txt');
    useStorageStore.getState().setRemotePath('/var');
    expect(useStorageStore.getState().remotePath).toBe('/var');
    expect(useStorageStore.getState().remoteSelection.size).toBe(0);
  });

  it('toggles local selection', () => {
    const store = useStorageStore.getState();
    store.toggleLocalSelection('a.txt');
    expect(useStorageStore.getState().localSelection.has('a.txt')).toBe(true);

    useStorageStore.getState().toggleLocalSelection('a.txt');
    expect(useStorageStore.getState().localSelection.has('a.txt')).toBe(false);
  });

  it('toggles hidden files', () => {
    expect(useStorageStore.getState().showHiddenFiles).toBe(false);
    useStorageStore.getState().toggleHiddenFiles();
    expect(useStorageStore.getState().showHiddenFiles).toBe(true);
    useStorageStore.getState().toggleHiddenFiles();
    expect(useStorageStore.getState().showHiddenFiles).toBe(false);
  });

  it('clears all selections', () => {
    useStorageStore.getState().toggleLocalSelection('a');
    useStorageStore.getState().toggleRemoteSelection('b');
    useStorageStore.getState().clearSelections();
    expect(useStorageStore.getState().localSelection.size).toBe(0);
    expect(useStorageStore.getState().remoteSelection.size).toBe(0);
  });

  it('sets and clears preview file', () => {
    const file = { name: 'test.txt', content: 'hello', type: 'text/plain', path: '/test.txt', isLocal: true };
    useStorageStore.getState().setPreviewFile(file);
    expect(useStorageStore.getState().previewFile).toEqual(file);

    useStorageStore.getState().setPreviewFile(null);
    expect(useStorageStore.getState().previewFile).toBeNull();
  });
});
