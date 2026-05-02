import { ipcMain, app, shell, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants'
import { checkForUpdate, installUpdate } from '../services/updater'
import log from '../lib/logger'

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_CHECK_UPDATE, () => {
    return checkForUpdate()
  })

  ipcMain.handle(IPC.APP_INSTALL_UPDATE, () => {
    installUpdate()
  })

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())

  ipcMain.handle(IPC.APP_GET_LOG_PATH, () => log.transports.file.getFile().path)

  ipcMain.handle(IPC.APP_OPEN_LOG_FILE, () => {
    shell.showItemInFolder(log.transports.file.getFile().path)
  })

  // Window management IPC
  ipcMain.handle(IPC.WINDOW_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IPC.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })
}
