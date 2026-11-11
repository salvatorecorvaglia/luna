import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  source: vi.fn(),
  done: vi.fn(),
  abort: vi.fn(),
  uploadConstructor: vi.fn(),
}));
vi.mock('../../../../src/main/services/storage/upload-source', () => ({
  openUploadSource: state.source,
}));
vi.mock('../../../../src/main/services/ssh-manager', () => ({
  sshManager: { onSessionDisconnect: vi.fn() },
}));
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    constructor(options: unknown) {
      state.uploadConstructor(options);
    }
    on() {}
    done() {
      return state.done();
    }
    abort() {
      return state.abort();
    }
  },
}));

import { s3StorageProvider } from '../../../../src/main/services/s3/s3-provider';
import { sftpManager } from '../../../../src/main/services/sftp-manager';

let root: string;
let handle: Awaited<ReturnType<typeof open>>;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'luna-upload-lifecycle-'));
  const path = join(root, 'file');
  await writeFile(path, 'payload');
  handle = await open(path, 'r');
  state.source.mockResolvedValue({ handle, stats: await handle.stat() });
  state.abort.mockResolvedValue(undefined);
  s3StorageProvider.openSession('upload-test', {
    connectionId: 'c',
    connectionName: 'test',
    accessKeyId: 'test',
    secretAccessKey: 'test',
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await handle.close();
  s3StorageProvider.closeSession('upload-test');
  await rm(root, { recursive: true, force: true });
});

function sftpHarness() {
  const data: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      data.push(Buffer.from(chunk));
      cb();
    },
  });
  const sftp = {
    createWriteStream: vi.fn(() => {
      queueMicrotask(() => sink.emit('open', Buffer.from('handle')));
      return sink;
    }),
    ext_openssh_rename: vi.fn((_src, _dest, cb) => cb()),
    realpath: vi.fn((path, cb) => cb(null, path)),
    stat: vi.fn((_path, cb) => cb(null, { mode: 0o640, isFile: () => true })),
    chmod: vi.fn((_path, _mode, cb) => cb()),
    utimes: vi.fn((_path, _a, _m, cb) => cb()),
    unlink: vi.fn((_path, cb) => cb()),
  };
  vi.spyOn(
    sftpManager as unknown as { getSftp: () => Promise<unknown> },
    'getSftp',
  ).mockResolvedValue(sftp);
  return { sftp, data, sink };
}

describe('upload resource lifecycle', () => {
  it('SFTP uses the validated handle, exclusively creates a private temporary file and closes the source', async () => {
    const { sftp, data } = sftpHarness();
    await sftpManager.streamUpload(
      'upload-test',
      '/validated/source',
      '/dest',
      vi.fn(),
      new AbortController().signal,
    );
    expect(Buffer.concat(data).toString()).toBe('payload');
    expect(sftp.createWriteStream).toHaveBeenCalledWith(
      expect.stringMatching(/^\/\.luna-partial-.+/),
      expect.objectContaining({ flags: 'wx', mode: 0o600 }),
    );
    expect(sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
    expect(handle.fd).toBe(-1);
  });

  it('SFTP closes the source if remote stream creation throws', async () => {
    const { sftp } = sftpHarness();
    sftp.createWriteStream.mockImplementation(() => {
      throw new Error('remote open failed');
    });
    await expect(
      sftpManager.streamUpload(
        'upload-test',
        '/source',
        '/dest',
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('remote open failed');
    expect(handle.fd).toBe(-1);
  });

  it('SFTP abort waits for remote teardown, removes its temporary file and never publishes it', async () => {
    const { sftp, sink } = sftpHarness();
    const controller = new AbortController();
    sink.once('open', () => controller.abort());
    await expect(
      sftpManager.streamUpload('upload-test', '/source', '/dest', vi.fn(), controller.signal),
    ).rejects.toThrow(/cancelled/);
    expect(sftp.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/^\/\.luna-partial-.+/),
      expect.any(Function),
    );
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(handle.fd).toBe(-1);
  });

  it('S3 consumes the validated handle and closes it on success', async () => {
    state.done.mockImplementation(async () => {
      const options = state.uploadConstructor.mock.calls[0]![0];
      const chunks: Buffer[] = [];
      for await (const chunk of options.params.Body) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('payload');
    });
    await s3StorageProvider.streamUpload(
      'upload-test',
      '/source',
      '/bucket/key',
      vi.fn(),
      new AbortController().signal,
    );
    expect(handle.fd).toBe(-1);
  });

  it('S3 closes the source when SDK construction throws', async () => {
    state.uploadConstructor.mockImplementationOnce(() => {
      throw new Error('SDK setup failed');
    });
    await expect(
      s3StorageProvider.streamUpload(
        'upload-test',
        '/source',
        '/bucket/key',
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('SDK setup failed');
    expect(handle.fd).toBe(-1);
  });

  it('S3 retains ownership until multipart abort cleanup settles', async () => {
    const controller = new AbortController();
    let finishAbort!: () => void;
    state.abort.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishAbort = resolve;
      }),
    );
    state.done.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    let settled = false;
    const pending = s3StorageProvider
      .streamUpload('upload-test', '/source', '/bucket/key', vi.fn(), controller.signal)
      .finally(() => {
        settled = true;
      });
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    await vi.waitFor(() => expect(state.abort).toHaveBeenCalled());
    expect(settled).toBe(false);
    finishAbort();
    await rejected;
    expect(handle.fd).toBe(-1);
  });
});

describe('atomic SFTP editor saves', () => {
  it('publishes only the complete file and preserves the original mode', async () => {
    const { sftp, data } = sftpHarness();
    await sftpManager.writeFile('upload-test', '/dest', 'edited');
    expect(Buffer.concat(data).toString()).toBe('edited');
    expect(sftp.chmod).toHaveBeenCalledWith(
      expect.stringMatching(/luna-partial/),
      0o640,
      expect.any(Function),
    );
    expect(sftp.ext_openssh_rename).toHaveBeenCalledWith(
      expect.stringMatching(/luna-partial/),
      '/dest',
      expect.any(Function),
    );
  });
  it('publishes to the resolved target when editing a symlink', async () => {
    const { sftp } = sftpHarness();
    sftp.realpath.mockImplementationOnce((_path, cb) => cb(null, '/real/file'));
    await sftpManager.writeFile('upload-test', '/link', 'edited');
    expect(sftp.ext_openssh_rename).toHaveBeenCalledWith(
      expect.stringMatching(/^\/real\/.luna-partial/),
      '/real/file',
      expect.any(Function),
    );
  });
  it('retains private permissions when chmod is explicitly unsupported', async () => {
    const { sftp } = sftpHarness();
    sftp.chmod.mockImplementationOnce((_path, _mode, cb) =>
      cb(Object.assign(new Error('unsupported'), { code: 8 })),
    );
    await expect(sftpManager.writeFile('upload-test', '/dest', 'edited')).resolves.toBeUndefined();
    expect(sftp.ext_openssh_rename).toHaveBeenCalled();
  });

  it('does not publish partial content after a stream write failure', async () => {
    const { sftp } = sftpHarness();
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('remote full'));
      },
    });
    sftp.createWriteStream.mockImplementationOnce(() => {
      queueMicrotask(() => sink.emit('open', Buffer.from('handle')));
      return sink;
    });
    await expect(sftpManager.writeFile('upload-test', '/dest', 'edited')).rejects.toThrow(
      'remote full',
    );
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(sftp.unlink).toHaveBeenCalledWith(
      expect.stringMatching(/luna-partial/),
      expect.any(Function),
    );
  });
  it('does not replace the original if preserving its mode fails', async () => {
    const { sftp } = sftpHarness();
    sftp.chmod.mockImplementationOnce((_path, _mode, cb) => cb(new Error('chmod denied')));
    await expect(sftpManager.writeFile('upload-test', '/dest', 'edited')).rejects.toThrow(
      'chmod denied',
    );
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(sftp.unlink).toHaveBeenCalled();
  });
});
