// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSftpDnd } from '../../../src/renderer/src/hooks/use-sftp-dnd';

const download = vi.fn();
const upload = vi.fn();
const joinPath = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (msg: string) => toastError(msg),
    warning: (msg: string) => toastWarning(msg),
  },
}));

const addTransfer = vi.fn();
vi.mock('@/stores/transfer-store', () => ({
  // Both access styles: selector hooks, and getState() as used by
  // lib/transfers.ts (enqueueTransfer), which the hook now goes through.
  useTransferStore: Object.assign(
    (selector: (s: { addTransfer: typeof addTransfer }) => unknown) => selector({ addTransfer }),
    { getState: () => ({ addTransfer, transfers: new Map(), removeTransfer: vi.fn() }) },
  ),
}));

beforeEach(() => {
  download.mockReset();
  upload.mockReset();
  joinPath.mockReset().mockImplementation(async (a: string, b: string) => `${a}/${b}`);
  toastError.mockReset();
  toastWarning.mockReset();
  addTransfer.mockReset();
  Object.assign(window, {
    api: {
      storage: { download, upload },
      shell: { joinPath },
    },
  });
});

/**
 * Build a minimal `React.DragEvent`-shaped object with a `dataTransfer` map
 * the hook can read. Only fields the hook touches are populated.
 */
function makeDropEvent(payload: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(payload));
  return {
    preventDefault: vi.fn(),
    dataTransfer: { getData: (k: string) => data.get(k) ?? '' },
  } as unknown as React.DragEvent;
}

describe('useSftpDnd — remote → local download', () => {
  it('rejects a pure ".." dragged name', async () => {
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'remote-path': '/etc/passwd',
      'file-name': '..',
      'file-size': '0',
      'is-directory': 'false',
    });
    await result.current.handleLocalDrop(e);
    expect(toastError).toHaveBeenCalledWith('Refused to transfer a file with an unsafe name.');
    expect(download).not.toHaveBeenCalled();
    expect(addTransfer).not.toHaveBeenCalled();
  });

  it('rejects names containing NUL bytes', async () => {
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'remote-path': '/etc/passwd',
      'file-name': 'evil\0.txt',
      'file-size': '0',
      'is-directory': 'false',
    });
    await result.current.handleLocalDrop(e);
    expect(download).not.toHaveBeenCalled();
  });

  it('strips path components from the dragged name and enqueues the download', async () => {
    download.mockImplementation(async (p: { transferId: string }) => p.transferId);
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'remote-path': '/srv/log.txt',
      // Multiple separators and surrounding whitespace must be stripped/trimmed
      'file-name': '  /srv/sub\\evil/log.txt  ',
      'file-size': '42',
      'is-directory': 'false',
    });
    await result.current.handleLocalDrop(e);
    expect(joinPath).toHaveBeenCalledWith('/tmp', 'log.txt');
    expect(download).toHaveBeenCalledWith({
      transferId: expect.any(String),
      sessionId: 's1',
      remotePath: '/srv/log.txt',
      localPath: '/tmp/log.txt',
    });
    expect(addTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: download.mock.calls[0]![0].transferId,
        type: 'download',
        fileName: 'log.txt',
      }),
    );
  });

  it('warns and bails on directory drops without enqueuing', async () => {
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'remote-path': '/srv/dir',
      'file-name': 'dir',
      'file-size': '0',
      'is-directory': 'true',
    });
    await result.current.handleLocalDrop(e);
    expect(toastWarning).toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('does nothing when activeSessionId is null', async () => {
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: null, localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'remote-path': '/srv/log.txt',
      'file-name': 'log.txt',
      'file-size': '0',
      'is-directory': 'false',
    });
    await result.current.handleLocalDrop(e);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('useSftpDnd — local → remote upload', () => {
  it('joins remotePath without a leading // when remotePath is /', async () => {
    upload.mockImplementation(async (p: { transferId: string }) => p.transferId);
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/' }),
    );
    const e = makeDropEvent({
      'local-path': '/tmp/log.txt',
      'file-name': 'log.txt',
      'file-size': '10',
      'is-directory': 'false',
    });
    await result.current.handleRemoteDrop(e);
    expect(upload).toHaveBeenCalledWith({
      transferId: expect.any(String),
      sessionId: 's1',
      localPath: '/tmp/log.txt',
      remotePath: '/log.txt',
    });
  });

  it('joins remotePath with a single / on a sub-path', async () => {
    upload.mockImplementation(async (p: { transferId: string }) => p.transferId);
    const { result } = renderHook(() =>
      useSftpDnd({ activeSessionId: 's1', localPath: '/tmp', remotePath: '/srv/logs' }),
    );
    const e = makeDropEvent({
      'local-path': '/tmp/log.txt',
      'file-name': 'log.txt',
      'file-size': '10',
      'is-directory': 'false',
    });
    await result.current.handleRemoteDrop(e);
    expect(upload).toHaveBeenCalledWith({
      transferId: expect.any(String),
      sessionId: 's1',
      localPath: '/tmp/log.txt',
      remotePath: '/srv/logs/log.txt',
    });
  });
});
