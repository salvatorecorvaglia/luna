import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/constants'
import { registerAllHandlers } from './ipc'
import { closeDatabase } from './services/database'
import { sshManager } from './services/ssh-manager'
import { sftpManager } from './services/sftp-manager'
import { initAutoUpdater } from './services/updater'
import log from './lib/logger'

// Global error handlers
process.on('uncaughtException', (err) => {
  log.error('[Main] Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('[Main] Unhandled rejection:', reason)
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url)
      } else {
        log.warn('[Main] Blocked openExternal for non-http(s) URL:', details.url)
      }
    } catch {
      log.warn('[Main] Blocked openExternal for invalid URL:', details.url)
    }
    return { action: 'deny' }
  })

  // Window management IPC
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize()
  })

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false
  })

  // HMR in dev, file:// in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerAllHandlers()
  createWindow()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  sftpManager.dispose()
  sshManager.disconnectAll()
  closeDatabase()
})
