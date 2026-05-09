import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../resources/lunar.png?asset';
import { registerAllHandlers } from './ipc';
import { setMainWindow } from './ipc/app.ipc';
import { disposeLocalTerminals } from './ipc/local-terminal.ipc';
import { closeDatabase, getDatabase, MigrationError } from './services/database';
import { sshManager } from './services/ssh-manager';
import { sftpManager } from './services/sftp-manager';
import { transferQueue } from './services/transfer-queue';
import { initAutoUpdater } from './services/updater';
import log from './lib/logger';
import { LunarError, ErrorCode } from '@shared/errors';

// Global error handlers. After an uncaughtException the process state is
// undefined per Node best practice — flush logs and exit so a supervisor /
// auto-relaunch can restart cleanly rather than letting the app limp along
// with corrupted internals.
process.on('uncaughtException', (err) => {
  const lunarError = LunarError.fromUnknown(err, ErrorCode.INTERNAL_ERROR);
  log.error('[Main] Uncaught exception:', lunarError.toObject());
  // Best-effort: shut the DB cleanly so the WAL is flushed before exit.
  try {
    closeDatabase();
  } catch {
    /* already in failure mode */
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const lunarError = LunarError.fromUnknown(reason, ErrorCode.INTERNAL_ERROR);
  log.error('[Main] Unhandled rejection:', lunarError.toObject());
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
      plugins: true,
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
      // https only — for a credential-handling app we don't want to launch
      // plaintext-http links, custom protocols, file://, data:, etc.
      if (parsed.protocol === 'https:') {
        shell.openExternal(details.url);
      } else {
        log.warn('[Main] Blocked openExternal for non-https URL:', details.url);
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
              "frame-src 'self'; " +
              "object-src 'none'",
          ],
        },
      });
    });
  }

  // Force-initialize the DB up front so a migration failure produces a
  // friendly dialog instead of a hard crash inside the first IPC call.
  try {
    getDatabase();
  } catch (err) {
    log.error('[Main] Database initialization failed:', err);
    const detail =
      err instanceof MigrationError
        ? `${err.message}\n\nYou can recover by either:\n` +
          ` • restoring a backup of your data folder, or\n` +
          ` • renaming "lunar.db" in the app data folder to start fresh (existing connections will be lost).`
        : err instanceof Error
          ? err.message
          : String(err);
    dialog.showErrorBox('Lunar — database error', detail);
    app.exit(1);
    return;
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

  // Watchdog: if any cleanup step hangs (a stuck SFTP/S3 abort that never
  // settles, a renderer process refusing to exit, etc.) force the process
  // down rather than letting "Quit" appear to do nothing. Critically, we
  // still flush the DB inside the watchdog — otherwise an SQLite WAL can
  // be left dangling and the next launch may surface a half-applied write.
  const watchdog = setTimeout(() => {
    log.warn('[Main] before-quit watchdog fired — forcing exit');
    try {
      closeDatabase();
    } catch (err) {
      log.error('[Main] watchdog closeDatabase error:', err);
    }
    app.exit(0);
  }, 3000);
  watchdog.unref();

  (async () => {
    try {
      transferQueue.cancelAll();
      sftpManager.dispose();
      sshManager.disconnectAll();
      disposeLocalTerminals();
      // Give in-flight aborts a window to settle. SFTP/S3 abort handlers
      // run asynchronously after `controller.abort()`, so an immediate quit
      // can leave a local file descriptor half-flushed. 500 ms is well under
      // the watchdog (3 s) and is invisible to the user during normal quit.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      log.error('[Main] before-quit cleanup error:', err);
    } finally {
      try {
        closeDatabase();
      } catch (err) {
        log.error('[Main] closeDatabase error:', err);
      }
      clearTimeout(watchdog);
      app.quit();
    }
  })();
});
