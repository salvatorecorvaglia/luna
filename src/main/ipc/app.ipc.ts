import { IPC } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import { app, BrowserWindow, shell, type WebContents } from 'electron';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { getCredentialBackendStatus } from '../services/credential-store';
import { s3StorageProvider } from '../services/s3/s3-provider';
import { sshManager } from '../services/ssh-manager';
import { checkForUpdate, installUpdate, openReleasePage } from '../services/updater';

let mainWindowRef: BrowserWindow | null = null;

/** Called from main/index.ts after window creation so window-control IPC can verify the sender. */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

/** Returns the main BrowserWindow reference (may be null if not yet created or destroyed). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef;
}

/** Longest URL we'll hand to the OS; far past any real link, well short of abuse. */
const MAX_EXTERNAL_URL_LEN = 2048;

/**
 * Validate a renderer-supplied URL for `shell.openExternal`: https only, the
 * same rule `setWindowOpenHandler` applies. openExternal hands the string to
 * the OS, where `file:`, custom schemes (`ms-msdt:`, `smb:`) and
 * `javascript:` each have their own history of turning a click into code
 * execution — so it is an allowlist, not a denylist.
 */
export function assertOpenableUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_EXTERNAL_URL_LEN) {
    throw new LunaError('url must be a non-empty string', ErrorCode.VALIDATION_ERROR);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LunaError('url is not a valid URL', ErrorCode.VALIDATION_ERROR);
  }
  if (parsed.protocol !== 'https:') {
    throw new LunaError('Only https links can be opened', ErrorCode.FORBIDDEN, {
      protocol: parsed.protocol,
    });
  }
  return parsed.href;
}

function assertFromMainWindow(sender: WebContents): BrowserWindow {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || !mainWindowRef || win.id !== mainWindowRef.id) {
    throw new LunaError('Window control is restricted to the main window', ErrorCode.FORBIDDEN);
  }
  return win;
}

export function registerAppHandlers(): void {
  registerHandler(IPC.APP_CHECK_UPDATE, () => {
    return checkForUpdate();
  });

  registerHandler(IPC.APP_INSTALL_UPDATE, () => installUpdate());

  registerHandler(IPC.APP_OPEN_RELEASE_PAGE, () => openReleasePage());

  // Terminal links (Cmd/Ctrl-click). xterm's web-links addon falls back to
  // window.open(), which setWindowOpenHandler receives as about:blank and
  // denies — so without this channel every link in the terminal was dead.
  registerHandler(IPC.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(assertOpenableUrl(url));
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
