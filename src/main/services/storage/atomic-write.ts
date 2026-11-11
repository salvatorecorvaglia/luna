import { randomUUID } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Publish a complete sibling file; a failed write never truncates the original. */
export async function atomicWriteText(target: string, content: string): Promise<void> {
  const previous = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous && !previous.isFile()) throw new Error('Destination must be a regular file');
  const temp = join(dirname(target), `.luna-save-${randomUUID()}`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    if (previous) await handle.chmod(previous.mode & 0o777);
    await handle.sync();
    await handle.close();
    await rename(temp, target);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}
