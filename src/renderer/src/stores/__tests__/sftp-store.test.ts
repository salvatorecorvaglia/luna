import { beforeEach, describe, expect, it } from 'vitest';
import { useSftpStore } from '../sftp-store';

describe('sftp-store', () => {
  beforeEach(() => {
    useSftpStore.setState({
      localPath: '',
      remotePath: '/',
      localSelection: new Set(),
      remoteSelection: new Set(),
      showHiddenFiles: false,
      previewFile: null,
      sftpSessionId: null,
    });
  });

  it('sets local path and clears selection', () => {
    useSftpStore.getState().toggleLocalSelection('file.txt');
    expect(useSftpStore.getState().localSelection.size).toBe(1);

    useSftpStore.getState().setLocalPath('/tmp');
    expect(useSftpStore.getState().localPath).toBe('/tmp');
    expect(useSftpStore.getState().localSelection.size).toBe(0);
  });

  it('sets remote path and clears selection', () => {
    useSftpStore.getState().toggleRemoteSelection('file.txt');
    useSftpStore.getState().setRemotePath('/var');
    expect(useSftpStore.getState().remotePath).toBe('/var');
    expect(useSftpStore.getState().remoteSelection.size).toBe(0);
  });

  it('toggles local selection', () => {
    const store = useSftpStore.getState();
    store.toggleLocalSelection('a.txt');
    expect(useSftpStore.getState().localSelection.has('a.txt')).toBe(true);

    useSftpStore.getState().toggleLocalSelection('a.txt');
    expect(useSftpStore.getState().localSelection.has('a.txt')).toBe(false);
  });

  it('toggles hidden files', () => {
    expect(useSftpStore.getState().showHiddenFiles).toBe(false);
    useSftpStore.getState().toggleHiddenFiles();
    expect(useSftpStore.getState().showHiddenFiles).toBe(true);
    useSftpStore.getState().toggleHiddenFiles();
    expect(useSftpStore.getState().showHiddenFiles).toBe(false);
  });

  it('clears all selections', () => {
    useSftpStore.getState().toggleLocalSelection('a');
    useSftpStore.getState().toggleRemoteSelection('b');
    useSftpStore.getState().clearSelections();
    expect(useSftpStore.getState().localSelection.size).toBe(0);
    expect(useSftpStore.getState().remoteSelection.size).toBe(0);
  });

  it('sets and clears preview file', () => {
    const file = { name: 'test.txt', content: 'hello', type: 'text/plain' };
    useSftpStore.getState().setPreviewFile(file);
    expect(useSftpStore.getState().previewFile).toEqual(file);

    useSftpStore.getState().setPreviewFile(null);
    expect(useSftpStore.getState().previewFile).toBeNull();
  });
});
