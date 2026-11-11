import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute } from 'node:path';
import { ErrorCode, LunaError } from '@shared/errors';
import { AbortError } from '../../lib/errors';
import { isInsideDir } from '../../lib/validate';

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Open at execution time; providers must stream from this handle, never reopen the path. */
export async function openUploadSource(localPath: string, signal: AbortSignal) {
  if (signal.aborted) throw new AbortError('Transfer cancelled');
  const home = await realpath(homedir());
  const denied = () =>
    new LunaError('Upload source changed or is outside the home directory', ErrorCode.FORBIDDEN);
  if (!isAbsolute(localPath) || !isInsideDir(localPath, home)) throw denied();

  // Snapshot every ancestor, not just the leaf. O_NOFOLLOW only covers the
  // final component. Revalidation detects directory replacements during open;
  // this is not an atomic openat jail against a hostile local process.
  const ancestors: { path: string; stats: Stats }[] = [];
  for (let path = dirname(localPath); ; path = dirname(path)) {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw denied();
    ancestors.push({ path, stats });
    if (path === dirname(path)) break;
  }
  const before = await lstat(localPath);
  if (!before.isFile() || before.isSymbolicLink()) throw denied();
  const handle = await open(
    localPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || !sameFile(before, stats)) throw denied();
    for (const ancestor of ancestors) {
      const after = await lstat(ancestor.path);
      if (!after.isDirectory() || !sameFile(ancestor.stats, after)) throw denied();
    }
    if (!isInsideDir(await realpath(localPath), home)) throw denied();
    if (signal.aborted) throw new AbortError('Transfer cancelled');
    return { handle, stats };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
