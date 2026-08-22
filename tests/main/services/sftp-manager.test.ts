import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { sshManager } from '../../../src/main/services/ssh-manager';

/** Reach into the private lease/idle/opening state machine for direct testing. */
function reachIn() {
  return sftpManager as unknown as {
    sftpSessions: Map<string, { on: ReturnType<typeof vi.fn>; end?: ReturnType<typeof vi.fn> }>;
    opening: Map<string, Promise<unknown>>;
    lastAccess: Map<string, number>;
    leases: Map<string, number>;
    closing: Set<string>;
    cleanupIdle(): void;
    acquireLease(id: string): void;
    getSftp(id: string): Promise<{ on: ReturnType<typeof vi.fn> }>;
    runOp<T>(
      id: string,
      op: string,
      fn: (sftp: unknown) => Promise<T>,
      timeoutMs?: number,
    ): Promise<T>;
    closeSftp(id: string): void;
  };
}

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

describe('SftpManager — getSftp() open coalescing', () => {
  beforeEach(() => {
    reachIn().sftpSessions.clear();
    reachIn().opening.clear();
    reachIn().lastAccess.clear();
    reachIn().leases.clear();
    reachIn().closing.clear();
    vi.mocked(sshManager.getSession).mockReset();
  });

  it('shares one client.sftp() call between concurrent getSftp() callers for the same session', async () => {
    let capturedCb: ((err: Error | null, sftp?: unknown) => void) | undefined;
    const sftpOpen = vi.fn((cb: (err: Error | null, sftp?: unknown) => void) => {
      capturedCb = cb;
    });
    vi.mocked(sshManager.getSession).mockReturnValue({
      client: { sftp: sftpOpen },
    } as unknown as ReturnType<typeof sshManager.getSession>);

    const reach = reachIn();
    const first = reach.getSftp('s1');
    const second = reach.getSftp('s1');

    // Both callers are in flight; only one real subsystem open should have
    // been issued — the second sees the shared in-flight promise instead of
    // triggering its own client.sftp() call (which would leak the loser).
    expect(sftpOpen).toHaveBeenCalledTimes(1);

    const fakeWrapper = { on: vi.fn() };
    capturedCb?.(null, fakeWrapper);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(fakeWrapper);
    expect(b).toBe(fakeWrapper);
  });
});

describe('SftpManager — idle sweep', () => {
  beforeEach(() => {
    reachIn().sftpSessions.clear();
    reachIn().opening.clear();
    reachIn().lastAccess.clear();
    reachIn().leases.clear();
    reachIn().closing.clear();
  });

  it('closes an idle, unleased session and leaves a leased one alone', () => {
    const reach = reachIn();
    const idleSftp = { on: vi.fn(), end: vi.fn() };
    const busySftp = { on: vi.fn(), end: vi.fn() };
    reach.sftpSessions.set('idle-session', idleSftp);
    reach.sftpSessions.set('busy-session', busySftp);
    // Epoch is far enough in the past for any real IDLE_TIMEOUT_MS.
    reach.lastAccess.set('idle-session', 0);
    reach.lastAccess.set('busy-session', 0);
    reach.leases.set('busy-session', 1);

    reach.cleanupIdle();

    expect(reach.sftpSessions.has('idle-session')).toBe(false);
    expect(idleSftp.end).toHaveBeenCalled();
    expect(reach.sftpSessions.has('busy-session')).toBe(true);
    expect(busySftp.end).not.toHaveBeenCalled();
  });

  it('acquireLease refuses a session that is mid-close', () => {
    const reach = reachIn();
    reach.closing.add('closing-session');

    expect(() => reach.acquireLease('closing-session')).toThrow(/closing/);
  });
});

describe('SftpManager — runOp fatal-error invalidation', () => {
  beforeEach(() => {
    reachIn().sftpSessions.clear();
    reachIn().opening.clear();
    reachIn().lastAccess.clear();
    reachIn().leases.clear();
    reachIn().closing.clear();
  });

  it('invalidates the session on a fatal error and does not double-release the lease', async () => {
    const reach = reachIn();
    const fakeSftp = { on: vi.fn(), end: vi.fn() };
    reach.sftpSessions.set('s1', fakeSftp);
    reach.lastAccess.set('s1', Date.now());

    await expect(
      reach.runOp('s1', 'test-op', async () => {
        throw new Error('channel closed unexpectedly');
      }),
    ).rejects.toThrow('channel closed unexpectedly');

    expect(fakeSftp.end).toHaveBeenCalled();
    expect(reach.sftpSessions.has('s1')).toBe(false);
    expect(reach.leases.has('s1')).toBe(false);
  });

  it('releases the lease normally when the operation succeeds', async () => {
    const reach = reachIn();
    const fakeSftp = { on: vi.fn(), end: vi.fn() };
    reach.sftpSessions.set('s1', fakeSftp);
    reach.lastAccess.set('s1', Date.now());

    const result = await reach.runOp('s1', 'test-op', async () => 'ok');

    expect(result).toBe('ok');
    expect(reach.leases.has('s1')).toBe(false);
    expect(reach.sftpSessions.has('s1')).toBe(true);
  });
});
