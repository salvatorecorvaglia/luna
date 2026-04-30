import { ipcMain, dialog } from 'electron'
import { readdir, stat, writeFile } from 'fs/promises'
import { join, basename, resolve, isAbsolute } from 'path'
import { homedir } from 'os'
import { IPC } from '@shared/constants'
import { assertValidPath } from '../lib/validate'
import type { LocalFileEntry } from '@shared/types/sftp'

export function registerShellHandlers(): void {
  ipcMain.handle(IPC.SHELL_READDIR, async (_event, dirPath: string) => {
    assertValidPath(dirPath, 'dirPath')
    if (!isAbsolute(dirPath)) {
      throw new Error('dirPath must be absolute')
    }
    const normalized = resolve(dirPath)
    // Defense-in-depth — restrict directory listing to the user's home subtree.
    const home = homedir()
    if (!normalized.startsWith(home + '/') && normalized !== home) {
      throw new Error('Access denied: directory listing is restricted to the home directory')
    }
    const entries = await readdir(normalized, { withFileTypes: true })
    const results: LocalFileEntry[] = []

    for (const entry of entries) {
      const fullPath = join(normalized, entry.name)
      try {
        // Always use stat() to follow symlinks consistently (resolves target type/size).
        const stats = await stat(fullPath)
        results.push({
          name: entry.name,
          path: fullPath,
          size: stats.size,
          modifiedAt: Math.floor(stats.mtimeMs / 1000),
          isDirectory: stats.isDirectory(),
          isSymlink: entry.isSymbolicLink()
        })
      } catch {
        // Skip files we can't stat (permission errors, broken symlinks)
      }
    }

    return results.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })

  ipcMain.handle(IPC.SHELL_HOME_DIR, () => {
    return homedir()
  })

  ipcMain.handle(
    IPC.SHELL_OPEN_FILE_DIALOG,
    async (_event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: options?.filters
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0]
    }
  )

  ipcMain.handle(
    IPC.SHELL_SAVE_FILE_DIALOG,
    async (
      _event,
      options: {
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        content: string
      }
    ) => {
      const result = await dialog.showSaveDialog({
        defaultPath: options.defaultPath,
        filters: options.filters
      })

      if (result.canceled || !result.filePath) return null

      // Cap content size so a misbehaving renderer can't write arbitrarily large files.
      const MAX_BYTES = 50 * 1024 * 1024 // 50 MB
      if (typeof options.content !== 'string') {
        throw new Error('content must be a string')
      }
      if (Buffer.byteLength(options.content, 'utf-8') > MAX_BYTES) {
        throw new Error(`content exceeds ${MAX_BYTES} bytes`)
      }
      await writeFile(result.filePath, options.content, 'utf-8')
      return result.filePath
    }
  )

  ipcMain.handle(
    IPC.SHELL_JOIN_PATH,
    (_event, { base, fileName }: { base: string; fileName: string }) => {
      assertValidPath(base, 'base')
      assertValidPath(fileName, 'fileName')
      // Sanitize: use only the basename to prevent path traversal
      const safeName = basename(fileName)
      // Resolve guarantees we stay under `base` after joining since safeName has no separators.
      return resolve(join(base, safeName))
    }
  )
}
