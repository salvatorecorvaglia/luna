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

  it('should throw SftpTransferError when max entries limit of 100,000 is exceeded', async () => {
    // Mock readdir to return 100,005 standard files in the first call.
    // This will hit the 100,000 limit instantly during loop iteration without causing recursive calls or timing out.
    const mockSftp = {
      readdir: vi.fn().mockImplementation((_path, cb) => {
        const files = Array.from({ length: 100005 }).map((_, i) => ({
          filename: `file-${i}.txt`,
          attrs: { mode: 0o100000 }, // Regular file mode, not directory
        }));
        cb(null, files);
      }),
      unlink: vi.fn().mockImplementation((_path, cb) => cb(null)),
      rmdir: vi.fn().mockImplementation((_path, cb) => cb(null)),
    } as unknown as SFTPWrapper;

    const privateSessions = (sftpManager as unknown as { sftpSessions: Map<string, SFTPWrapper> })
      .sftpSessions;
    privateSessions.set(sessionId, mockSftp);

    await expect(sftpManager.remove(sessionId, '/start', true)).rejects.toThrow(
      /visited entries exceed 100000/i,
    );

    privateSessions.delete(sessionId);
  });
});
