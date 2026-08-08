import { IPC } from '@shared/constants';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from '../lib/logger';
import { emitToRenderer } from './emit';

let updateAvailable = false;
let updateVersion = '';
let inFlightCheck: Promise<unknown> | null = null;

function checkOnce(): Promise<unknown> {
  if (!app.isPackaged) return Promise.resolve(null);
  if (inFlightCheck) return inFlightCheck;
  inFlightCheck = autoUpdater.checkForUpdates().finally(() => {
    inFlightCheck = null;
  });
  return inFlightCheck;
}

export function initAutoUpdater(): void {
  // Hard-fail closed in unpackaged builds. `app.isPackaged` is false in dev
  // and for tampered packages whose `package.json` was edited at rest, so a
  // running binary that lies about being packaged also gets no auto-update.
  if (!app.isPackaged) {
    log.info('[Updater] Skipping auto-update setup (app not packaged).');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Lock down against downgrade-attack feeds: an adversary controlling the
  // update channel must not be able to roll users back to a known-vulnerable
  // older build (cf. CVE-2020-15257 style attacks). Both are false by default
  // in current electron-updater, but pin explicitly so a future default
  // change can't quietly widen our attack surface.
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  // Refuse cached partial downloads from a prior session that may have been
  // tampered with on disk between launches. With this off, electron-updater
  // streams the full installer and re-verifies the signature each run.
  autoUpdater.disableDifferentialDownload = true;

  // Refuse to operate against an unencrypted update feed.
  // Note: electron-updater already enforces HTTPS by default for most providers.
  autoUpdater.on('login', () => {
    log.warn('[Updater] NTLM/Proxy authentication requested.');
  });

  autoUpdater.on('update-available', (info) => {
    updateAvailable = true;
    updateVersion = info.version;
    emitToRenderer(IPC.APP_UPDATE_AVAILABLE, { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    updateAvailable = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    emitToRenderer(IPC.APP_UPDATE_DOWNLOAD_PROGRESS, {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    emitToRenderer(IPC.APP_UPDATE_DOWNLOADED, {});
  });

  autoUpdater.on('error', (err) => {
    let errorMessage = err.message;
    if (
      errorMessage.includes('code signature at URL') ||
      errorMessage.includes('did not pass validation')
    ) {
      errorMessage =
        'Auto-update is currently unavailable because the application is not signed with a developer certificate. Please download the latest version manually from GitHub.';
    }
    log.error('[Updater] Error:', errorMessage);
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage });
  });

  // Check for updates after a short delay
  setTimeout(() => {
    checkOnce().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('[Updater] Initial check failed:', msg);
    });
  }, 5000);
}

/**
 * Run a check and report what it found.
 *
 * This used to fire `checkOnce()` and return the module-level state
 * synchronously, without waiting — so "Check for updates" could only ever
 * report the outcome of a check that had already finished. On the first click
 * that state is always "no update available", regardless of what the feed
 * says. Awaiting the check is the whole point of the button.
 *
 * A failed check still resolves (with the last known state) rather than
 * rejecting: a transient network error should read as "no update right now",
 * not as an error dialog. The `update-available` / `update-not-available`
 * listeners in `initAutoUpdater` have already run by the time the promise
 * settles, so the values read below are current.
 */
export async function checkForUpdate(): Promise<{ available: boolean; version?: string }> {
  try {
    await checkOnce();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('[Updater] Manual check failed:', msg);
  }
  return { available: updateAvailable, version: updateVersion || undefined };
}

export function installUpdate(): void {
  // Same guard as initAutoUpdater — a renderer that calls install in an
  // unpackaged build must not be able to coerce the updater into running.
  if (!app.isPackaged) {
    log.warn('[Updater] Refusing installUpdate: app is not packaged.');
    return;
  }

  autoUpdater
    .downloadUpdate()
    .then(() => {
      autoUpdater.quitAndInstall(false, true);
    })
    .catch((err) => {
      let errorMessage = err.message;
      if (
        errorMessage.includes('code signature at URL') ||
        errorMessage.includes('did not pass validation')
      ) {
        errorMessage =
          'Update download failed: the new version cannot be verified (missing code signature). Please update manually from GitHub.';
      }
      log.error('[Updater] Failed to download update:', errorMessage);
      emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage });
    });
}
