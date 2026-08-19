import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/services/ssh-manager', () => ({
  sshManager: {
    getSession: vi.fn(),
    onSessionDisconnect: vi.fn(),
  },
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { sftpManager } from '../../../src/main/services/sftp-manager';

/** Minimal fake shaped like the SFTPWrapper surface publishUploadedFile uses. */
interface FakeSftp {
  ext_openssh_rename: (src: string, dest: string, cb: (err?: Error) => void) => void;
  rename: (src: string, dest: string, cb: (err?: Error) => void) => void;
  unlink: (path: string, cb: (err?: Error) => void) => void;
}

/**
 * publishUploadedFile is private — this is the standard TS pattern for
 * reaching a private method directly in a unit test without widening the
 * class's public API just to make it testable.
 */
function publish(sftp: FakeSftp, tempPath: string, destPath: string): Promise<void> {
  return (
    sftpManager as unknown as {
      publishUploadedFile(sftp: FakeSftp, tempPath: string, destPath: string): Promise<void>;
    }
  ).publishUploadedFile(sftp, tempPath, destPath);
}

const err = (message: string): Error => new Error(message);
const BACKUP_PATH = '/a/f.txt.luna-partial.bak';

describe('SftpManager.publishUploadedFile', () => {
  it('resolves via the OpenSSH posix-rename extension when the server supports it, without ever touching plain rename/unlink', async () => {
    const extRename = vi.fn((_s, _d, cb) => cb());
    const rename = vi.fn();
    const unlink = vi.fn();

    await publish({ ext_openssh_rename: extRename, rename, unlink }, '/a/f.tmp', '/a/f.txt');

    expect(extRename).toHaveBeenCalledWith('/a/f.tmp', '/a/f.txt', expect.any(Function));
    expect(rename).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('falls back to plain rename when the extension is unsupported and the destination does not yet exist', async () => {
    const extRename = vi.fn((_s, _d, cb) => cb(err('OP_UNSUPPORTED')));
    const rename = vi.fn((_s, _d, cb) => cb());
    const unlink = vi.fn();

    await publish({ ext_openssh_rename: extRename, rename, unlink }, '/a/f.tmp', '/a/f.txt');

    expect(rename).toHaveBeenCalledWith('/a/f.tmp', '/a/f.txt', expect.any(Function));
    expect(unlink).not.toHaveBeenCalled();
  });

  it('non-destructively swaps an existing destination aside when both the extension and plain rename fail, then cleans up the backup', async () => {
    const calls: string[] = [];
    const extRename = vi.fn((_s, _d, cb) => cb(err('OP_UNSUPPORTED')));
    let publishAttempt = 0;
    const rename = vi.fn((src: string, dest: string, cb: (e?: Error) => void) => {
      if (src === '/a/f.tmp' && dest === '/a/f.txt') {
        publishAttempt++;
        if (publishAttempt === 1) {
          calls.push('publish-attempt-1-fails');
          cb(err('Failure')); // plain SFTP v3 rename: destination already exists
        } else {
          calls.push('publish-attempt-2-succeeds');
          cb();
        }
        return;
      }
      if (src === '/a/f.txt' && dest === BACKUP_PATH) {
        calls.push('existing-file-backed-up');
        cb();
        return;
      }
      cb(err(`unexpected rename(${src}, ${dest})`));
    });
    const unlink = vi.fn((_p, cb) => cb());

    await publish({ ext_openssh_rename: extRename, rename, unlink }, '/a/f.tmp', '/a/f.txt');

    expect(calls).toEqual([
      'publish-attempt-1-fails',
      'existing-file-backed-up',
      'publish-attempt-2-succeeds',
    ]);
    // The backup is deleted only after the swap fully succeeds.
    expect(unlink).toHaveBeenCalledWith(BACKUP_PATH, expect.any(Function));
  });

  it('rejects with the original rename error and touches nothing else if there is no existing file to back up', async () => {
    const extRename = vi.fn((_s, _d, cb) => cb(err('OP_UNSUPPORTED')));
    const unlink = vi.fn();
    const rename = vi.fn((src: string, _dest: string, cb: (e?: Error) => void) => {
      // First call: publish attempt fails (some non-"already exists" reason).
      // Second call: backing up a nonexistent destination also fails.
      if (src === '/a/f.tmp') return cb(err('permission denied'));
      return cb(err('ENOENT'));
    });

    await expect(
      publish({ ext_openssh_rename: extRename, rename, unlink }, '/a/f.tmp', '/a/f.txt'),
    ).rejects.toThrow('permission denied');
    expect(unlink).not.toHaveBeenCalled();
  });

  it('restores the original file if the final publish rename fails after the backup swap, and never deletes anything', async () => {
    const calls: string[] = [];
    const extRename = vi.fn((_s, _d, cb) => cb(err('OP_UNSUPPORTED')));
    let publishAttempt = 0;
    const rename = vi.fn((src: string, dest: string, cb: (e?: Error) => void) => {
      if (src === '/a/f.tmp' && dest === '/a/f.txt') {
        publishAttempt++;
        if (publishAttempt === 1) {
          calls.push('publish-attempt-1-fails');
          cb(err('Failure'));
        } else {
          calls.push('publish-attempt-2-fails-disk-full');
          cb(err('ENOSPC'));
        }
        return;
      }
      if (src === '/a/f.txt' && dest === BACKUP_PATH) {
        calls.push('existing-file-backed-up');
        cb();
        return;
      }
      if (src === BACKUP_PATH && dest === '/a/f.txt') {
        calls.push('backup-restored');
        cb();
        return;
      }
      cb(err(`unexpected rename(${src}, ${dest})`));
    });
    const unlink = vi.fn();

    await expect(
      publish({ ext_openssh_rename: extRename, rename, unlink }, '/a/f.tmp', '/a/f.txt'),
    ).rejects.toThrow('ENOSPC');

    expect(calls).toEqual([
      'publish-attempt-1-fails',
      'existing-file-backed-up',
      'publish-attempt-2-fails-disk-full',
      'backup-restored',
    ]);
    // The original file must never be permanently lost on this path.
    expect(unlink).not.toHaveBeenCalled();
  });
});
