import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron';
import { IPC } from '@shared/constants';
import { checkForUpdate, installUpdate } from '../services/updater';
import { sshManager } from '../services/ssh-manager';
import { s3StorageProvider } from '../services/s3/s3-provider';
import log from '../lib/logger';

let mainWindowRef: BrowserWindow | null = null;

/** Called from main/index.ts after window creation so window-control IPC can verify the sender. */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

function assertFromMainWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || !mainWindowRef || win.id !== mainWindowRef.id) {
    throw new Error('Window control is restricted to the main window');
  }
  return win;
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.APP_CHECK_UPDATE, () => {
    return checkForUpdate();
  });

  ipcMain.handle(IPC.APP_INSTALL_UPDATE, () => {
    installUpdate();
  });

  ipcMain.handle(IPC.APP_GET_ACTIVE_SESSIONS, () => {
    return {
      ssh: sshManager.listSessions(),
      s3: s3StorageProvider.listSessions(),
    };
  });

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion());

  ipcMain.handle(IPC.APP_GET_LOG_PATH, () => log.transports.file.getFile().path);

  ipcMain.handle(IPC.APP_OPEN_LOG_FILE, () => {
    shell.showItemInFolder(log.transports.file.getFile().path);
  });

  // Window management IPC — only the main window may control itself.
  ipcMain.handle(IPC.WINDOW_MINIMIZE, (event) => {
    assertFromMainWindow(event.sender).minimize();
  });

  ipcMain.handle(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = assertFromMainWindow(event.sender);
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IPC.WINDOW_CLOSE, (event) => {
    assertFromMainWindow(event.sender).close();
  });

  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    return assertFromMainWindow(event.sender).isMaximized();
  });
}
