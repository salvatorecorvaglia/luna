import { constants as fsConstants } from 'node:fs';
import { access, lstat, open, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { BINARY_PREVIEW_EXTENSIONS, IPC } from '@shared/constants';
import { ErrorCode, LunarError } from '@shared/errors';
import type { LocalFileEntry } from '@shared/types/sftp';
import { dialog } from 'electron';
import { registerHandler } from '../lib/ipc-handler';
import { cliReferenceService } from '../services/cli-reference-service';
import { sessionAuditService } from '../services/session-audit-service';
import { shellHistoryService } from '../services/shell-history-service';
import {
  assertSafeAbsolutePath,
  assertSafeRealAbsolutePath,
  assertValidPath,
  expandAndConfineToHome,
  expandAndValidatePrivateKeyPath,
  isInsideDir,
} from '../lib/validate';

export function registerShellHandlers(): void {
  registerHandler(IPC.SHELL_READDIR, async (_event, dirPath: string) => {
    assertValidPath(dirPath, 'dirPath');
    if (!isAbsolute(dirPath)) {
      throw new LunarError('dirPath must be absolute', ErrorCode.VALIDATION_ERROR);
    }
    const normalized = resolve(dirPath);
    // Defense-in-depth — restrict directory listing to the user's home subtree.
    // Use path.relative-based check so look-alike names like `/home/user-other`
    // can't slip past a naive `startsWith(home + '/')` prefix match.
    const home = homedir();
    if (!isInsideDir(normalized, home)) {
      throw new LunarError(
        'Access denied: directory listing is restricted to the home directory',
        ErrorCode.FORBIDDEN,
      );
    }
    const entries = await readdir(normalized, { withFileTypes: true });
    const results: LocalFileEntry[] = [];

    const limit = 50; // Batch limit to prevent OS file descriptor exhaustion
    const chunks: (typeof entries)[] = [];
    for (let i = 0; i < entries.length; i += limit) {
      chunks.push(entries.slice(i, i + limit));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (entry) => {
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
                // realpath dereferences symlinks; resolve() only canonicalises the
                // path string, so a symlink targeting /etc would slip past the
                // home-jail check.
                const targetPath = await realpath(fullPath);
                const stillUnderHome = isInsideDir(targetPath, home);
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
            return {
              name: entry.name,
              path: fullPath,
              size,
              modifiedAt: Math.floor(mtimeMs / 1000),
              isDirectory: targetIsDirectory,
              isSymlink: entry.isSymbolicLink(),
            };
          } catch {
            // Skip files we can't stat (permission errors, broken symlinks)
            return null;
          }
        }),
      );
      for (const res of chunkResults) {
        if (res) results.push(res);
      }
    }

    return results.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  });

  registerHandler(IPC.SHELL_HOME_DIR, () => {
    return homedir();
  });

  registerHandler(
    IPC.SHELL_OPEN_FILE_DIALOG,
    async (_event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: options?.filters,
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return realpath(result.filePaths[0]);
    },
  );

  registerHandler(
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
        throw new LunarError('content must be a string', ErrorCode.VALIDATION_ERROR);
      }
      if (Buffer.byteLength(options.content, 'utf-8') > MAX_BYTES) {
        throw new LunarError(`content exceeds ${MAX_BYTES} bytes`, ErrorCode.VALIDATION_ERROR);
      }
      const safePath = resolve(result.filePath);
      await writeFile(safePath, options.content, 'utf-8');
      return safePath;
    },
  );

  registerHandler(IPC.SHELL_CHECK_FILE, async (_event, filePath: string) => {
    // Best-effort readability probe used by the connection form to validate a
    // private-key path before submission. Returns a structured result
    // rather than throwing so the renderer can surface a precise error.
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { ok: false, reason: 'empty' as const };
    }
    let expanded: string;
    try {
      expanded = await expandAndValidatePrivateKeyPath(filePath, 'filePath');
    } catch (err) {
      if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        return { ok: false, reason: 'missing' as const };
      }
      return { ok: false, reason: 'forbidden' as const };
    }
    try {
      const ls = await lstat(expanded);
      if (!ls.isFile() && !ls.isSymbolicLink()) {
        return { ok: false, reason: 'not-a-file' as const };
      }
      if (ls.isSymbolicLink()) {
        await realpath(expanded);
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

  registerHandler(
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
  registerHandler(IPC.SHELL_READ_FILE, async (_event, filePath: string) => {
    assertValidPath(filePath, 'filePath');
    // expandAndConfineToHome handles ~ expansion, absolute-path enforcement,
    // and home-jail confinement consistently with the rest of the IPC layer.
    const expanded = await expandAndConfineToHome(filePath, 'filePath');
    const home = homedir();

    // Resolve symlinks to their real target *before* reading so we cannot be
    // TOCTOU'd between the jail check and readFile().
    const ls = await lstat(expanded);
    const target = ls.isSymbolicLink() ? await realpath(expanded) : expanded;
    if (!isInsideDir(target, home)) {
      throw new LunarError(
        'Access denied: symlink target is outside the home directory',
        ErrorCode.FORBIDDEN,
      );
    }

    // Open with O_NOFOLLOW so the read is anchored to the inode we just
    // validated. If `target` is swapped to a symlink between realpath() and
    // open(), the open fails with ELOOP instead of silently following the
    // attacker's link out of the home jail.
    const fh = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const s = await fh.stat();
      if (!s.isFile()) {
        throw new LunarError('Not a regular file', ErrorCode.VALIDATION_ERROR);
      }
      const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
      if (s.size > MAX_BYTES) {
        throw new LunarError(
          `File is too large (${Math.round(s.size / 1024 / 1024)}MB). Max 50MB.`,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const data = await fh.readFile();
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const isBinary = BINARY_PREVIEW_EXTENSIONS.has(ext);

      return {
        content: data.toString(isBinary ? 'base64' : 'utf-8'),
        encoding: isBinary ? 'base64' : 'utf-8',
        size: s.size,
      };
    } finally {
      await fh.close();
    }
  });

  registerHandler(
    IPC.SHELL_WRITE_FILE,
    async (_event, { filePath, content }: { filePath: string; content: string }) => {
      assertValidPath(filePath, 'filePath');
      if (typeof content !== 'string') {
        throw new LunarError('content must be a string', ErrorCode.VALIDATION_ERROR);
      }
      const expanded = await expandAndConfineToHome(filePath, 'filePath');
      const target = await assertSafeRealAbsolutePath(expanded, 'filePath');

      const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
      if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
        throw new LunarError(`Content exceeds maximum size of 50MB`, ErrorCode.VALIDATION_ERROR);
      }

      await writeFile(target, content, 'utf-8');
    },
  );

  registerHandler(IPC.SHELL_CLI_REFERENCE, (_event, query: string) => {
    return cliReferenceService.searchDocs(query);
  });

  registerHandler(
    IPC.SHELL_SEARCH_HISTORY,
    (_event, payload: { query: string; limit?: number }) => {
      return shellHistoryService.searchHistory(payload?.query || '', payload?.limit || 50);
    },
  );

  registerHandler(IPC.SHELL_EXPORT_AUDIT_LOG, (_event, options: any) => {
    return sessionAuditService.exportAuditLog(options);
  });
}
