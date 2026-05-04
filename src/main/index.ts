import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../resources/lunar.png?asset';
import { registerAllHandlers } from './ipc';
import { setMainWindow } from './ipc/app.ipc';
import { closeDatabase } from './services/database';
import { sshManager } from './services/ssh-manager';
import { sftpManager } from './services/sftp-manager';
import { transferQueue } from './services/transfer-queue';
import { initAutoUpdater } from './services/updater';
import log from './lib/logger';

// Global error handlers
process.on('uncaughtException', (err) => {
  log.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  log.error('[Main] Unhandled rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 16 },
    backgroundColor: '#09090b',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  setMainWindow(mainWindow);
  mainWindow.on('closed', () => {
    setMainWindow(null);
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url);
      } else {
        log.warn('[Main] Blocked openExternal for non-http(s) URL:', details.url);
      }
    } catch {
      log.warn('[Main] Blocked openExternal for invalid URL:', details.url);
    }
    return { action: 'deny' };
  });

  // HMR in dev, file:// in production
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Content-Security-Policy: lock the renderer to its own bundle in production.
  // Skipped in dev because Vite's HMR client uses inline scripts + a websocket
  // back to localhost, which a strict policy would block (resulting in a blank
  // window). Production loads from file:// where 'self' is sufficient.
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
              "script-src 'self'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self'; " +
              "frame-ancestors 'none'; " +
              "base-uri 'self'; " +
              "form-action 'none'; " +
              "object-src 'none'",
          ],
        },
      });
    });
  }

  registerAllHandlers();
  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let isQuitting = false;

app.on('before-quit', (event) => {
  if (isQuitting) return;
  // Cancel in-flight transfers, dispose timers, then wait for things to settle
  // before letting the process exit. Without this, an SFTP transfer's local
  // file descriptor can be left half-flushed.
  isQuitting = true;
  event.preventDefault();
  (async () => {
    try {
      transferQueue.cancelAll();
      sftpManager.dispose();
      sshManager.disconnectAll();
      // Give in-flight aborts a short window to settle.
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    } catch (err) {
      log.error('[Main] before-quit cleanup error:', err);
    } finally {
      try {
        closeDatabase();
      } catch (err) {
        log.error('[Main] closeDatabase error:', err);
      }
      app.quit();
    }
  })();
});
