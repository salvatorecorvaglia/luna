import { dialog, ipcMain } from 'electron';
import { access, lstat, readdir, stat, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { basename, isAbsolute, join, resolve } from 'path';
import { homedir } from 'os';
import { IPC } from '@shared/constants';
import { assertSafeAbsolutePath, assertValidPath } from '../lib/validate';
import type { LocalFileEntry } from '@shared/types/sftp';

export function registerShellHandlers(): void {
  ipcMain.handle(IPC.SHELL_READDIR, async (_event, dirPath: string) => {
    assertValidPath(dirPath, 'dirPath');
    if (!isAbsolute(dirPath)) {
      throw new Error('dirPath must be absolute');
    }
    const normalized = resolve(dirPath);
    // Defense-in-depth — restrict directory listing to the user's home subtree.
    const home = homedir();
    if (!normalized.startsWith(home + '/') && normalized !== home) {
      throw new Error('Access denied: directory listing is restricted to the home directory');
    }
    const entries = await readdir(normalized, { withFileTypes: true });
    const results: LocalFileEntry[] = [];

    for (const entry of entries) {
      const fullPath = join(normalized, entry.name);
      try {
        // Use lstat for symlinks so we don't disclose metadata of files outside
        // the home jail via symlink targets. For symlinks we also stat()
        // to determine whether the target is a directory (used for navigation),
        // but only when the target resolves *within* the home subtree.
        const ls = await lstat(fullPath);
        let targetIsDirectory = ls.isDirectory();
        let size = ls.size;
        let mtimeMs = ls.mtimeMs;
        if (ls.isSymbolicLink()) {
          try {
            const target = await stat(fullPath);
            const targetPath = resolve(fullPath);
            const stillUnderHome = targetPath.startsWith(home + '/') || targetPath === home;
            if (stillUnderHome) {
              targetIsDirectory = target.isDirectory();
              size = target.size;
              mtimeMs = target.mtimeMs;
            } else {
              targetIsDirectory = false;
            }
          } catch {
            // Broken symlink: keep lstat values, treat as non-directory.
            targetIsDirectory = false;
          }
        }
        results.push({
          name: entry.name,
          path: fullPath,
          size,
          modifiedAt: Math.floor(mtimeMs / 1000),
          isDirectory: targetIsDirectory,
          isSymlink: entry.isSymbolicLink(),
        });
      } catch {
        // Skip files we can't stat (permission errors, broken symlinks)
      }
    }

    return results.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  });

  ipcMain.handle(IPC.SHELL_HOME_DIR, () => {
    return homedir();
  });

  ipcMain.handle(
    IPC.SHELL_OPEN_FILE_DIALOG,
    async (_event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: options?.filters,
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return result.filePaths[0];
    },
  );

  ipcMain.handle(
    IPC.SHELL_SAVE_FILE_DIALOG,
    async (
      _event,
      options: {
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
        content: string;
      },
    ) => {
      const result = await dialog.showSaveDialog({
        defaultPath: options.defaultPath,
        filters: options.filters,
      });

      if (result.canceled || !result.filePath) return null;

      // Cap content size so a misbehaving renderer can't write arbitrarily large files.
      const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
      if (typeof options.content !== 'string') {
        throw new Error('content must be a string');
      }
      if (Buffer.byteLength(options.content, 'utf-8') > MAX_BYTES) {
        throw new Error(`content exceeds ${MAX_BYTES} bytes`);
      }
      await writeFile(result.filePath, options.content, 'utf-8');
      return result.filePath;
    },
  );

  ipcMain.handle(IPC.SHELL_CHECK_FILE, async (_event, filePath: string) => {
    // Best-effort readability probe used by the connection form to validate a
    // private-key path before submission. Returns a structured result
    // rather than throwing so the renderer can surface a precise error.
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { ok: false, reason: 'empty' as const };
    }
    const expanded = filePath.replace(/^~/, homedir());
    try {
      const ls = await lstat(expanded);
      if (!ls.isFile() && !ls.isSymbolicLink()) {
        return { ok: false, reason: 'not-a-file' as const };
      }
      await access(expanded, fsConstants.R_OK);
      return { ok: true as const };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ok: false, reason: 'missing' as const };
      if (code === 'EACCES') return { ok: false, reason: 'permission' as const };
      return { ok: false, reason: 'unknown' as const };
    }
  });

  ipcMain.handle(
    IPC.SHELL_JOIN_PATH,
    (_event, { base, fileName }: { base: string; fileName: string }) => {
      // base must be an absolute, canonical, home-confined path. Otherwise a
      // relative `../../etc` would join with basename(fileName) into a path
      // that escapes the user's home — `resolve()` alone wouldn't catch it
      // because resolve makes any relative input absolute against cwd.
      assertSafeAbsolutePath(base, 'base');
      assertValidPath(fileName, 'fileName');
      // Sanitize: use only the basename to prevent path traversal
      const safeName = basename(fileName);
      return resolve(join(base, safeName));
    },
  );
  ipcMain.handle(IPC.SHELL_READ_FILE, async (_event, filePath: string) => {
    assertValidPath(filePath, 'filePath');
    const expanded = resolve(filePath.replace(/^~/, homedir()));

    // Jail check
    const home = homedir();
    if (!expanded.startsWith(home + '/') && expanded !== home) {
      throw new Error('Access denied: file reading is restricted to the home directory');
    }

    const s = await stat(expanded);
    const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
    if (s.size > MAX_BYTES) {
      throw new Error(`File is too large (${Math.round(s.size / 1024 / 1024)}MB). Max 50MB.`);
    }

    const { readFile } = await import('fs/promises');
    const data = await readFile(expanded);
    return {
      content: data.toString('base64'),
      size: s.size,
    };
  });
}
