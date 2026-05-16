import type { SFTPWrapper } from 'ssh2';
import { createReadStream, createWriteStream } from 'fs';
import { stat as fsStat, unlink } from 'fs/promises';
import { sshManager } from './ssh-manager';
import type { SftpEntry } from '@shared/types/sftp';
import { BINARY_PREVIEW_EXTENSIONS, LIMITS } from '@shared/constants';
import { withTimeout } from '../lib/with-timeout';
import log from '../lib/logger';
import { AbortError, SftpTransferError, SshConnectionError } from '../lib/errors';
import { releaseStorageBucket } from '../lib/rate-limiter';
import { formatPermissions, isSessionFatal } from './sftp/sftp-helpers';
import { getRuntimeNumber } from '../config/runtime';

// Deliberately do NOT import transferQueue here — that created a cycle
// (sftp-manager ↔ transfer-queue). Transfer enqueueing is the IPC layer's
// responsibility now; sftp-manager only owns the streaming primitives.

type StepCallback = (transferred: number, chunk: number, total: number) => void;

// Read once at module load: these don't need per-call overrides, but keeping
// them in the settings table makes them tunable without a rebuild.
const IDLE_TIMEOUT_MS = getRuntimeNumber('SFTP_IDLE_TIMEOUT_MS');
const IDLE_CHECK_INTERVAL_MS = getRuntimeNumber('SFTP_IDLE_CHECK_INTERVAL_MS');
const ABORT_CLEANUP_DELAY_MS = getRuntimeNumber('SFTP_ABORT_CLEANUP_DELAY_MS');

class SftpManager {
  private sftpSessions = new Map<string, SFTPWrapper>();
  /**
   * In-flight SFTP-subsystem open promises, keyed by sessionId. Concurrent
   * callers of getSftp() for the same session share one open instead of each
   * opening a fresh subsystem and discarding all but the last — which leaks
   * the SFTPWrapper instances we drop on the floor when `sftpSessions.set`
   * overwrites them.
   */
  private opening = new Map<string, Promise<SFTPWrapper>>();
  private lastAccess = new Map<string, number>();
  /** Number of in-flight ops per session — idle sweep skips sessions with leases > 0. */
  private leases = new Map<string, number>();
  /**
   * Sessions in the middle of being torn down. New lease acquisitions throw
   * so a concurrent op can't grab a session that's about to close.
   */
  private closing = new Set<string>();
  /** Timer handle so the interval can be cleared on dispose. */
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    sshManager.onSessionDisconnect((sessionId) => {
      this.sftpSessions.delete(sessionId);
      this.opening.delete(sessionId);
      this.lastAccess.delete(sessionId);
      this.leases.delete(sessionId);
      this.closing.delete(sessionId);
      // Free the rate-limiter bucket so disconnected sessions don't accumulate.
      releaseStorageBucket(sessionId);
    });

    this.idleCheckTimer = setInterval(() => this.cleanupIdle(), IDLE_CHECK_INTERVAL_MS);
    // Unref so an unexpected uncaughtException-then-quit path can't be
    // held open by this timer alone if `before-quit` doesn't fire (e.g. a
    // crash during init). Production cleanup still goes through dispose().
    this.idleCheckTimer.unref?.();
  }

  /** Stop the idle-sweep timer. Call from `before-quit`. */
  dispose(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
  }

  private cleanupIdle(): void {
    const now = Date.now();
    // Snapshot the entries first: closeSftp() mutates lastAccess, which
    // would otherwise risk skipping or revisiting entries during iteration.
    for (const [sessionId, lastTime] of Array.from(this.lastAccess)) {
      if (
        now - lastTime > IDLE_TIMEOUT_MS &&
        (this.leases.get(sessionId) ?? 0) === 0 &&
        !this.closing.has(sessionId)
      ) {
        // Mark closing *before* the synchronous close so a concurrent acquireLease
        // (which checks the flag) can't sneak in between the check and the close.
        this.closing.add(sessionId);
        // Recheck after marking: if the lease counter ticked up between the
        // earlier read and this point (single-threaded JS makes this only
        // possible if a microtask executed mid-loop, but defending against
        // future restructuring is cheap), bail out and leave the session.
        if ((this.leases.get(sessionId) ?? 0) > 0) {
          this.closing.delete(sessionId);
          continue;
        }
        log.info(`[SFTP] Closing idle session: ${sessionId}`);
        try {
          this.closeSftp(sessionId);
        } finally {
          this.closing.delete(sessionId);
        }
      }
    }
  }

  private acquireLease(sessionId: string): void {
    if (this.closing.has(sessionId)) {
      throw new SshConnectionError('SFTP session is closing');
    }
    this.leases.set(sessionId, (this.leases.get(sessionId) ?? 0) + 1);
    this.lastAccess.set(sessionId, Date.now());
  }

  private releaseLease(sessionId: string): void {
    const next = (this.leases.get(sessionId) ?? 0) - 1;
    if (next <= 0) this.leases.delete(sessionId);
    else this.leases.set(sessionId, next);
    this.lastAccess.set(sessionId, Date.now());
  }

  async getSftp(sessionId: string): Promise<SFTPWrapper> {
    this.lastAccess.set(sessionId, Date.now());
    const existing = this.sftpSessions.get(sessionId);
    if (existing) return existing;

    // Coalesce concurrent opens. Without this, two callers entering getSftp()
    // before either has installed the wrapper would both call client.sftp(),
    // each get a fresh SFTPWrapper, and the second sftpSessions.set() would
    // strand the first (no end() call, no close listener attached → leak).
    const inFlight = this.opening.get(sessionId);
    if (inFlight) return inFlight;

    const session = sshManager.getSession(sessionId);
    if (!session) {
      throw new SshConnectionError('SSH session not found');
    }

    // Wrap the sftp() callback in a timeout. ssh2's client.sftp() has no
    // intrinsic deadline — if the server is unresponsive or the underlying
    // TCP socket hangs mid-SSH-channel-open, the callback never fires and
    // every subsequent SFTP op (list, stat, transfer) is queued behind a
    // promise that will never settle. The cap mirrors STORAGE_OP_TIMEOUT_MS
    // so the worst case for any SFTP op is one timeout window.
    const open = withTimeout(
      new Promise<SFTPWrapper>((resolve, reject) => {
        session.client.sftp((err, sftp) => {
          if (err) return reject(err);
          this.sftpSessions.set(sessionId, sftp);

          sftp.on('close', () => {
            this.sftpSessions.delete(sessionId);
          });

          resolve(sftp);
        });
      }),
      LIMITS.STORAGE_OP_TIMEOUT_MS,
      `sftp:open(${sessionId})`,
    ).finally(() => {
      // Clear the reservation once the open settles so a later disconnect →
      // reconnect cycle can open a fresh subsystem. Equality check protects
      // against an unrelated entry installed by a race.
      if (this.opening.get(sessionId) === open) this.opening.delete(sessionId);
    });
    this.opening.set(sessionId, open);
    return open;
  }

  /** Run an SFTP operation with timeout + auto-invalidate the session on fatal errors. */
  private async runOp<T>(
    sessionId: string,
    op: string,
    fn: (sftp: SFTPWrapper) => Promise<T>,
    timeoutMs: number = LIMITS.STORAGE_OP_TIMEOUT_MS,
  ): Promise<T> {
    this.acquireLease(sessionId);
    let releasedInCatch = false;
    try {
      const sftp = await this.getSftp(sessionId);
      return await withTimeout(fn(sftp), timeoutMs, `sftp:${op}`);
    } catch (err) {
      if (isSessionFatal(err)) {
        log.warn(`[SFTP] Invalidating session ${sessionId} after ${op} failure: ${String(err)}`);
        // closeSftp wipes the leases entry entirely; mark released so finally is a no-op.
        this.closeSftp(sessionId);
        releasedInCatch = true;
        throw err;
      }
      throw err;
    } finally {
      if (!releasedInCatch && this.leases.has(sessionId)) this.releaseLease(sessionId);
    }
  }

  async list(sessionId: string, remotePath: string): Promise<SftpEntry[]> {
    return this.runOp(sessionId, 'list', (sftp) => {
      return new Promise<SftpEntry[]>((resolve, reject) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) return reject(err);
          const entries: SftpEntry[] = list.map((item) => {
            const fileType = item.attrs.mode & 0o170000;
            const isDir = fileType === 0o40000;
            const isLink = fileType === 0o120000;
            return {
              name: item.filename,
              // Strip any trailing separators on remotePath before joining so
              // a caller-supplied `/home/user/` doesn't yield `//file`, which
              // downstream rename/delete then sees as a different entry.
              path:
                remotePath === '/'
                  ? `/${item.filename}`
                  : `${remotePath.replace(/\/+$/, '')}/${item.filename}`,
              size: item.attrs.size,
              modifiedAt: item.attrs.mtime,
              isDirectory: isDir,
              isSymlink: isLink,
              permissions: formatPermissions(item.attrs.mode),
              owner: item.attrs.uid,
              group: item.attrs.gid,
            };
          });
          resolve(entries);
        });
      });
    });
  }

  async mkdir(sessionId: string, remotePath: string): Promise<void> {
    return this.runOp(sessionId, 'mkdir', (sftp) => {
      return new Promise<void>((resolve, reject) => {
        sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve()));
      });
    });
  }

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return this.runOp(sessionId, 'rename', (sftp) => {
      return new Promise<void>((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err) => (err ? reject(err) : resolve()));
      });
    });
  }

  async remove(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    if (isDirectory) {
      return this.runOp(
        sessionId,
        'rmdir',
        (sftp) => this.removeDir(sftp, remotePath),
        LIMITS.STORAGE_OP_TIMEOUT_MS * 4, // recursive ops can be slow
      );
    }
    return this.runOp(sessionId, 'unlink', (sftp) => {
      return new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()));
      });
    });
  }

  /** Hard cap on recursive removeDir depth — defends against symlink/mountpoint cycles. */
  private static readonly REMOVE_DIR_MAX_DEPTH = 64;
  /** Hard cap on entries visited across the whole tree — defends against fan-out. */
  private static readonly REMOVE_DIR_MAX_ENTRIES = 100_000;
  private static readonly REMOVE_DIR_BATCH_SIZE = 5;

  private async removeDir(
    sftp: SFTPWrapper,
    dirPath: string,
    depth = 0,
    visited = { count: 0 },
  ): Promise<void> {
    if (depth > SftpManager.REMOVE_DIR_MAX_DEPTH) {
      throw new SftpTransferError(
        `Refusing to recurse into ${dirPath}: max depth ${SftpManager.REMOVE_DIR_MAX_DEPTH} exceeded (possible symlink loop)`,
      );
    }
    if (visited.count > SftpManager.REMOVE_DIR_MAX_ENTRIES) {
      throw new SftpTransferError(
        `Refusing to continue: visited entries exceed ${SftpManager.REMOVE_DIR_MAX_ENTRIES} (suspected mount/loop)`,
      );
    }

    const entries = await new Promise<{ filename: string; attrs: { mode: number } }[]>(
      (resolve, reject) => {
        sftp.readdir(dirPath, (err, list) => {
          if (err) return reject(err);
          resolve(
            list.map((item) => ({ filename: item.filename, attrs: { mode: item.attrs.mode } })),
          );
        });
      },
    );

    for (let i = 0; i < entries.length; i += SftpManager.REMOVE_DIR_BATCH_SIZE) {
      const batch = entries.slice(i, i + SftpManager.REMOVE_DIR_BATCH_SIZE);
      await Promise.all(
        batch.map(async (entry) => {
          visited.count++;
          if (visited.count > SftpManager.REMOVE_DIR_MAX_ENTRIES) {
            throw new SftpTransferError(
              `Refusing to continue: visited entries exceed ${SftpManager.REMOVE_DIR_MAX_ENTRIES} (suspected mount/loop)`,
            );
          }
          const fullPath = dirPath === '/' ? `/${entry.filename}` : `${dirPath}/${entry.filename}`;
          // readdir on most servers returns lstat-style modes (no symlink follow), so
          // entry.attrs.mode reflects the link itself. Symlinks are unlinked, never recursed.
          const fileType = entry.attrs.mode & 0o170000;
          const isSymlink = fileType === 0o120000;
          const isDir = fileType === 0o40000;
          if (isDir && !isSymlink) {
            await this.removeDir(sftp, fullPath, depth + 1, visited);
          } else {
            await new Promise<void>((resolve, reject) => {
              sftp.unlink(fullPath, (err) => (err ? reject(err) : resolve()));
            });
          }
        }),
      );
    }

    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(dirPath, (err) => (err ? reject(err) : resolve()));
    });
  }

  async readFile(
    sessionId: string,
    remotePath: string,
    maxSize?: number,
  ): Promise<{ content: string; encoding: 'utf-8' | 'base64' }> {
    const limit = Math.min(maxSize || LIMITS.MAX_PREVIEW_BYTES, LIMITS.MAX_PREVIEW_BYTES);
    return this.runOp(sessionId, 'readFile', (sftp) => {
      return new Promise<{ content: string; encoding: 'utf-8' | 'base64' }>((resolve, reject) => {
        let settled = false;
        let activeStream: ReturnType<SFTPWrapper['createReadStream']> | null = null;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          if (activeStream && !activeStream.destroyed) {
            try {
              activeStream.destroy();
            } catch {
              // ignore
            }
          }
          fn();
        };

        sftp.stat(remotePath, (err, stats) => {
          if (err) return settle(() => reject(err));
          if (stats.size > limit) {
            return settle(() =>
              reject(
                new SftpTransferError(
                  `File too large to preview: ${stats.size} bytes (max ${limit}). Download it instead.`,
                ),
              ),
            );
          }

          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(remotePath);
          activeStream = stream;
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () =>
            settle(() => {
              const buffer = Buffer.concat(chunks);
              const ext = remotePath.split('.').pop()?.toLowerCase() || '';
              const isBinary = BINARY_PREVIEW_EXTENSIONS.has(ext);
              resolve({
                content: buffer.toString(isBinary ? 'base64' : 'utf-8'),
                encoding: isBinary ? 'base64' : 'utf-8',
              });
            }),
          );
          stream.on('error', (err: Error) => settle(() => reject(err)));
          stream.on('close', () => {
            settle(() => reject(new SshConnectionError('SFTP stream closed before completion')));
          });
        });
      });
    });
  }

  async statSize(sessionId: string, remotePath: string): Promise<number> {
    return this.runOp(sessionId, 'stat', (sftp) => {
      return new Promise<number>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats.size)));
      });
    });
  }

  async stat(sessionId: string, remotePath: string) {
    return this.runOp(sessionId, 'stat', (sftp) => {
      return new Promise<{
        size: number;
        mode: number;
        modifiedAt: number;
        uid: number;
        gid: number;
        isDirectory: boolean;
        isSymlink: boolean;
        permissions: string;
      }>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
          if (err) return reject(err);
          const fileType = stats.mode & 0o170000;
          resolve({
            size: stats.size,
            mode: stats.mode,
            modifiedAt: stats.mtime,
            uid: stats.uid,
            gid: stats.gid,
            isDirectory: fileType === 0o040000,
            isSymlink: fileType === 0o120000,
            permissions: formatPermissions(stats.mode),
          });
        });
      });
    });
  }

  /**
   * Stream-based download with abort support.
   * On abort, partial local file is removed.
   */
  async streamDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    this.acquireLease(sessionId);
    try {
      return await this._streamDownload(sessionId, remotePath, localPath, onStep, signal);
    } finally {
      this.releaseLease(sessionId);
    }
  }

  private async _streamDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    let total = 0;
    try {
      total = await new Promise<number>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats.size)));
      });
    } catch {
      // size unknown — progress will lack a denominator
    }

    let transferred = 0;
    const readStream = sftp.createReadStream(remotePath);
    const writeStream = createWriteStream(localPath);

    // Race guard: an abort landing microseconds after the last byte hit disk
    // would otherwise destroy() the writeStream (preventing 'finish') and
    // unlink a complete file. Before discarding the partial download, verify
    // the file on disk doesn't already match the expected size.
    const cleanupOnAbort = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        readStream.destroy();
        writeStream.destroy();
        setTimeout(resolve, ABORT_CLEANUP_DELAY_MS);
      });
      if (total > 0) {
        try {
          const stats = await fsStat(localPath);
          if (stats.size >= total) return;
        } catch {
          // ENOENT or stat error — fall through to unlink (no-op if missing)
        }
      }
      await unlink(localPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
          log.warn(`[SFTP] Failed to remove partial download ${localPath}:`, err.message);
        }
      });
    };

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = (): void => {
        // If 'finish' has already been emitted (the abort lost the race), the
        // file is fully on disk — resolve instead of running the cleanup path.
        if (writeStream.writableFinished) {
          settle(() => resolve());
          return;
        }
        settle(() => cleanupOnAbort().finally(() => reject(new AbortError('Transfer cancelled'))));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        onStep(transferred, chunk.length, total);
      });
      readStream.on('error', (err: Error) => {
        settle(() => cleanupOnAbort().finally(() => reject(err)));
      });
      writeStream.on('error', (err: Error) => {
        settle(() => cleanupOnAbort().finally(() => reject(err)));
      });
      writeStream.on('finish', () => {
        settle(() => resolve());
      });

      readStream.pipe(writeStream);
    });
  }

  /**
   * Stream-based upload with abort support.
   * On abort, the partial remote file is removed.
   */
  async streamUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    this.acquireLease(sessionId);
    try {
      return await this._streamUpload(sessionId, localPath, remotePath, onStep, signal);
    } finally {
      this.releaseLease(sessionId);
    }
  }

  private async _streamUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    let total = 0;
    try {
      const stats = await fsStat(localPath);
      total = stats.size;
    } catch {
      // size unknown
    }

    let transferred = 0;
    let writeClosed = false;
    const readStream = createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);

    // Race guard: if 'close' has already been emitted (upload completed
    // on the remote), an abort landing immediately after must NOT unlink
    // the now-complete remote file.
    const cleanupOnAbort = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        readStream.destroy();
        writeStream.destroy();
        setTimeout(resolve, ABORT_CLEANUP_DELAY_MS);
      });
      if (writeClosed) return;
      await new Promise<void>((resolve) => {
        sftp.unlink(remotePath, () => resolve());
      });
    };

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = (): void => {
        if (writeClosed) {
          settle(() => resolve());
          return;
        }
        settle(() => cleanupOnAbort().finally(() => reject(new AbortError('Transfer cancelled'))));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        onStep(transferred, chunk.length, total);
      });
      readStream.on('error', (err: Error) => {
        settle(() => cleanupOnAbort().finally(() => reject(err)));
      });
      writeStream.on('error', (err: Error) => {
        settle(() => cleanupOnAbort().finally(() => reject(err)));
      });
      writeStream.on('close', () => {
        writeClosed = true;
        settle(() => resolve());
      });

      readStream.pipe(writeStream);
    });
  }

  // Download()/upload() removed from this class. They were one-line
  // delegations to transferQueue.enqueue(...) and forced sftp-manager to
  // import transferQueue, which in turn imports sftp-manager — a cycle.
  // The IPC layer now calls transferQueue.enqueue directly.

  closeSftp(sessionId: string): void {
    const sftp = this.sftpSessions.get(sessionId);
    if (sftp) {
      try {
        sftp.end();
      } catch {
        // ignore close errors on an already-broken handle
      }
      this.sftpSessions.delete(sessionId);
    }
    this.lastAccess.delete(sessionId);
    this.leases.delete(sessionId);
  }
}

export const sftpManager = new SftpManager();
