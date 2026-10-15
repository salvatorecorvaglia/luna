import type { SFTPWrapper } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { sftpManager } from '../../../../src/main/services/sftp-manager';

vi.mock('../../../../src/main/services/ssh-manager', () => ({
  sshManager: {
    onSessionDisconnect: vi.fn().mockReturnValue(vi.fn()),
    getSession: vi.fn().mockReturnValue({
      client: {
        sftp: vi.fn(),
      },
    }),
  },
}));

describe('sftpManager removeDir limits', () => {
  const sessionId = 'test-sftp-session';

  it('should throw SftpTransferError when depth limit of 64 is exceeded (loop protection)', async () => {
    // Mock readdir to continuously return a subdirectory so it keeps recursing
    const mockSftp = {
      readdir: vi.fn().mockImplementation((_path, cb) => {
        // Return a mock directory entry to force deep recursion
        cb(null, [{ filename: 'subdir', attrs: { mode: 0o40000 } }]);
      }),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    } as unknown as SFTPWrapper;

    const privateSessions = (sftpManager as unknown as { sftpSessions: Map<string, SFTPWrapper> })
      .sftpSessions;
    privateSessions.set(sessionId, mockSftp);

    await expect(sftpManager.remove(sessionId, '/start', true)).rejects.toThrow(
      /max depth 64 exceeded/i,
    );

    privateSessions.delete(sessionId);
  });

  it('refuses a directory over the 100,000-entry cap before deleting anything in it', async () => {
    // The cap used to be checked per entry as unlinks ran, so a "suspected
    // loop" still deleted 100,000 files before refusing.
    const unlink = vi.fn().mockImplementation((_path, cb) => cb(null));
    const mockSftp = {
      readdir: vi.fn().mockImplementation((_path, cb) => {
        const files = Array.from({ length: 100005 }).map((_, i) => ({
          filename: `file-${i}.txt`,
          attrs: { mode: 0o100000 }, // Regular file mode, not directory
        }));
        cb(null, files);
      }),
      unlink,
      rmdir: vi.fn().mockImplementation((_path, cb) => cb(null)),
    } as unknown as SFTPWrapper;

    const privateSessions = (sftpManager as unknown as { sftpSessions: Map<string, SFTPWrapper> })
      .sftpSessions;
    privateSessions.set(sessionId, mockSftp);
    try {
      await expect(sftpManager.remove(sessionId, '/start', true)).rejects.toThrow(
        /visited entries exceed 100000/i,
      );
      expect(unlink).not.toHaveBeenCalled();
    } finally {
      privateSessions.delete(sessionId);
    }
  });
});

describe('sftpManager.readFile bounds', () => {
  const sessionId = 'test-sftp-read';

  it('stops reading a special file whose stat size is 0 once the limit is exceeded', async () => {
    // /dev/zero and /proc entries report size 0, so the stat() check passes
    // and the stream never ends; the read used to buffer until the 30 s
    // timeout, which also tore the shared SFTP channel down.
    const { PassThrough } = await import('node:stream');
    const stream = new PassThrough();
    const mockSftp = {
      stat: vi.fn((_p, cb) => cb(null, { size: 0 })),
      createReadStream: vi.fn(() => stream),
    } as unknown as SFTPWrapper;

    const privateSessions = (sftpManager as unknown as { sftpSessions: Map<string, SFTPWrapper> })
      .sftpSessions;
    privateSessions.set(sessionId, mockSftp);
    try {
      const pending = sftpManager.readFile(sessionId, '/dev/zero', 16);
      await vi.waitFor(() => expect(mockSftp.createReadStream).toHaveBeenCalled());
      stream.write(Buffer.alloc(10));
      stream.write(Buffer.alloc(10));
      await expect(pending).rejects.toThrow(/16-byte preview limit/);
      expect(stream.destroyed).toBe(true);
    } finally {
      privateSessions.delete(sessionId);
    }
  });
});

describe('sftpManager timeout handling', () => {
  const sessionId = 'test-sftp-timeout';
  type Internals = {
    sftpSessions: Map<string, SFTPWrapper>;
    leases: Map<string, number>;
    acquireLease(id: string): number;
    releaseLease(id: string, gen: number): void;
  };
  const internals = sftpManager as unknown as Internals;

  function hangingSftp(): SFTPWrapper {
    return {
      readdir: vi.fn(), // never calls back
      end: vi.fn(),
    } as unknown as SFTPWrapper;
  }

  it('keeps the channel when a slow op times out while others are still running', async () => {
    // Regression: every timeout was "session fatal", so one slow listing tore
    // down the channel under an unrelated transfer sharing it.
    vi.useFakeTimers();
    const sftp = hangingSftp();
    internals.sftpSessions.set(sessionId, sftp);
    const transferGen = internals.acquireLease(sessionId); // a transfer in flight
    try {
      const listing = sftpManager.list(sessionId, '/huge').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await listing).toBeInstanceOf(Error);
      expect(internals.sftpSessions.get(sessionId)).toBe(sftp);
      expect(sftp.end).not.toHaveBeenCalled();
    } finally {
      internals.releaseLease(sessionId, transferGen);
      internals.sftpSessions.delete(sessionId);
      vi.useRealTimers();
    }
  });

  it('invalidates the channel when the timed-out op was the only one in flight', async () => {
    vi.useFakeTimers();
    const sftp = hangingSftp();
    internals.sftpSessions.set(sessionId, sftp);
    try {
      const listing = sftpManager.list(sessionId, '/').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(31_000);
      await listing;
      expect(internals.sftpSessions.has(sessionId)).toBe(false);
      expect(sftp.end).toHaveBeenCalled();
    } finally {
      internals.sftpSessions.delete(sessionId);
      vi.useRealTimers();
    }
  });

  it('ignores a release from before the channel was closed', () => {
    // Regression: closeSftp wiped the counts, and late releases then
    // decremented leases taken on the new channel — letting the idle sweep
    // close a session that was busy.
    const staleGen = internals.acquireLease(sessionId);
    sftpManager.closeSftp(sessionId);
    const freshGen = internals.acquireLease(sessionId);
    internals.releaseLease(sessionId, staleGen);
    expect(internals.leases.get(sessionId)).toBe(1);
    internals.releaseLease(sessionId, freshGen);
    expect(internals.leases.has(sessionId)).toBe(false);
  });
});
