import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openUploadSource } from '../../../../src/main/services/storage/upload-source';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => state.home,
}));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}));
let root: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'luna-upload-source-')));
  state.home = join(root, 'home');
  await fs.mkdir(state.home);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('upload source handles', () => {
  it('streams from the validated inode even if the pathname is replaced later', async () => {
    const path = join(state.home, 'file');
    await fs.writeFile(path, 'original');
    const { handle, stats } = await openUploadSource(path, new AbortController().signal);
    try {
      await fs.rename(path, `${path}.old`);
      await fs.writeFile(path, 'replacement');
      expect(stats.size).toBe(8);
      const chunks: Buffer[] = [];
      for await (const chunk of handle.createReadStream({ autoClose: false })) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('original');
    } finally {
      await handle.close();
    }
  });

  it('rejects directories and outside-home sources', async () => {
    await expect(openUploadSource(state.home, new AbortController().signal)).rejects.toThrow();
    const outside = join(root, 'outside');
    await fs.writeFile(outside, 'secret');
    await expect(openUploadSource(outside, new AbortController().signal)).rejects.toThrow(
      /outside/,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a queued source replaced by a symlink',
    async () => {
      const outside = join(root, 'outside');
      await fs.writeFile(outside, 'secret');
      const path = join(state.home, 'file');
      await fs.symlink(outside, path);
      await expect(openUploadSource(path, new AbortController().signal)).rejects.toThrow();
    },
  );

  it.skipIf(process.platform === 'win32')('rejects a replaced intermediate directory', async () => {
    const outside = join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'file'), 'secret');
    await fs.symlink(outside, join(state.home, 'linked'));
    await expect(
      openUploadSource(join(state.home, 'linked/file'), new AbortController().signal),
    ).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')(
    'detects an ancestor replaced during open and closes the acquired handle',
    async () => {
      const directory = join(state.home, 'dir');
      await fs.mkdir(directory);
      const path = join(directory, 'file');
      await fs.writeFile(path, 'original');
      const originalOpen = fs.open;
      let opened: Awaited<ReturnType<typeof fs.open>> | undefined;
      vi.spyOn(fs, 'open').mockImplementationOnce(async (p, flags) => {
        opened = await originalOpen(p, flags);
        await fs.rename(directory, `${directory}.old`);
        await fs.mkdir(directory);
        await fs.writeFile(path, 'replacement');
        return opened;
      });
      await expect(openUploadSource(path, new AbortController().signal)).rejects.toThrow(/changed/);
      expect(opened?.fd).toBe(-1);
    },
  );

  it('closes the handle if cancellation arrives during open', async () => {
    const path = join(state.home, 'file');
    await fs.writeFile(path, 'data');
    const controller = new AbortController();
    const originalOpen = fs.open;
    let opened: Awaited<ReturnType<typeof fs.open>> | undefined;
    vi.spyOn(fs, 'open').mockImplementationOnce(async (path, flags) => {
      opened = await originalOpen(path, flags);
      controller.abort();
      return opened;
    });
    await expect(openUploadSource(path, controller.signal)).rejects.toThrow(/cancelled/);
    expect(opened?.fd).toBe(-1);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a source swapped between validation and open',
    async () => {
      const path = join(state.home, 'file');
      await fs.writeFile(path, 'original');
      const outside = join(root, 'outside');
      await fs.writeFile(outside, 'secret');
      const originalOpen = fs.open;
      vi.spyOn(fs, 'open').mockImplementationOnce(async (p, flags) => {
        expect(Number(flags) & constants.O_NOFOLLOW).not.toBe(0);
        await fs.unlink(path);
        await fs.symlink(outside, path);
        return originalOpen(p, flags);
      });
      await expect(openUploadSource(path, new AbortController().signal)).rejects.toThrow();
    },
  );
});
