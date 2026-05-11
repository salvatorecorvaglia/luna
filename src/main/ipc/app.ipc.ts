import { app, BrowserWindow, shell, type WebContents } from 'electron';
import { IPC } from '@shared/constants';
import { checkForUpdate, installUpdate } from '../services/updater';
import { sshManager } from '../services/ssh-manager';
import { s3StorageProvider } from '../services/s3/s3-provider';
import { getCredentialBackendStatus } from '../services/credential-store';
import log from '../lib/logger';
import { registerHandler } from '../lib/ipc-handler';
import { ErrorCode, LunarError } from '@shared/errors';

let mainWindowRef: BrowserWindow | null = null;

/** Called from main/index.ts after window creation so window-control IPC can verify the sender. */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

/** Returns the main BrowserWindow reference (may be null if not yet created or destroyed). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}

function assertFromMainWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || !mainWindowRef || win.id !== mainWindowRef.id) {
    throw new LunarError('Window control is restricted to the main window', ErrorCode.FORBIDDEN);
  }
  return win;
}

export function registerAppHandlers(): void {
  registerHandler(IPC.APP_CHECK_UPDATE, () => {
    return checkForUpdate();
  });

  registerHandler(IPC.APP_INSTALL_UPDATE, () => {
    installUpdate();
  });

  registerHandler(IPC.APP_GET_ACTIVE_SESSIONS, () => {
    return {
      ssh: sshManager.listSessions(),
      s3: s3StorageProvider.listSessions(),
    };
  });

  registerHandler(IPC.APP_GET_VERSION, () => app.getVersion());

  registerHandler(IPC.APP_GET_CREDENTIAL_BACKEND, () => getCredentialBackendStatus());

  registerHandler(IPC.APP_GET_LOG_PATH, () => log.transports.file.getFile().path);

  registerHandler(IPC.APP_OPEN_LOG_FILE, () => {
    shell.showItemInFolder(log.transports.file.getFile().path);
  });

  // Window management IPC — only the main window may control itself.
  registerHandler(IPC.WINDOW_MINIMIZE, (event) => {
    assertFromMainWindow(event.sender).minimize();
  });

  registerHandler(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = assertFromMainWindow(event.sender);
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  registerHandler(IPC.WINDOW_CLOSE, (event) => {
    assertFromMainWindow(event.sender).close();
  });

  registerHandler(IPC.WINDOW_IS_MAXIMIZED, (event) => {
    return assertFromMainWindow(event.sender).isMaximized();
  });
}
