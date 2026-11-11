import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicWriteText } from '../../../../src/main/services/storage/atomic-write';

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}));
let root: string;
let target: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'luna-atomic-save-'));
  target = join(root, 'file.txt');
  await fs.writeFile(target, 'original', { mode: 0o640 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
describe('atomic text saves', () => {
  it('replaces content, preserves file permissions, and removes its temporary artifact', async () => {
    await atomicWriteText(target, 'replacement');
    expect(await fs.readFile(target, 'utf8')).toBe('replacement');
    if (process.platform !== 'win32') expect((await fs.stat(target)).mode & 0o777).toBe(0o640);
    expect(await fs.readdir(root)).toEqual(['file.txt']);
  });
  it('retains the original if a write fails after producing partial content', async () => {
    const originalOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementationOnce(async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode);
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await handle.write('partial');
        throw new Error('ENOSPC');
      });
      return handle;
    });
    await expect(atomicWriteText(target, 'replacement')).rejects.toThrow('ENOSPC');
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect(await fs.readdir(root)).toEqual(['file.txt']);
  });
  it('retains the original if publication fails', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename refused'));
    await expect(atomicWriteText(target, 'replacement')).rejects.toThrow('rename refused');
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect(await fs.readdir(root)).toEqual(['file.txt']);
  });
  it('creates new files privately', async () => {
    const path = join(root, 'new.txt');
    await atomicWriteText(path, 'new');
    expect(await fs.readFile(path, 'utf8')).toBe('new');
    if (process.platform !== 'win32') expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
  });
});
