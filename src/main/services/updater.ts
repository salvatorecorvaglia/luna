import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { IPC } from '@shared/constants';
import { app, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from '../lib/logger';
import { emitToRenderer } from './emit';
import {
  applyStagedUpdate,
  cleanupStaleStageDirs,
  hasStagedUpdate,
  isSelfInstallSupported,
  type SelfUpdateInfo,
  stageUpdate,
} from './mac-self-update';
import { RELEASES_URL } from './release';

const execFileAsync = promisify(execFile);

/** Re-exported so callers keep a single import for everything update-related. */
export { RELEASES_URL };

const MANUAL_UPDATE_MESSAGE =
  'This build cannot install updates itself. Download the latest version from GitHub.';

/**
 * How this build can take an update:
 *  - `squirrel` — electron-updater installs it (Windows, Linux, signed macOS)
 *  - `self`     — an ad-hoc macOS build replaces its own bundle, see
 *                 `mac-self-update.ts`
 *  - `manual`   — neither is possible; the user downloads from GitHub
 */
type UpdateMode = 'squirrel' | 'self' | 'manual';

let updateAvailable = false;
let updateVersion = '';
let inFlightCheck: Promise<unknown> | null = null;
let autoInstallSupport: Promise<boolean> | null = null;
/** The feed entry for the pending update — the self-installer needs its files. */
let pendingUpdateInfo: SelfUpdateInfo | null = null;
/** Guards a second "Download" press from starting a parallel download. */
let selfInstallInFlight = false;

/**
 * Can this running binary actually replace itself?
 *
 * macOS updates go through Squirrel.Mac, which refuses to swap in a bundle
 * whose code signature does not satisfy the *running* app's designated
 * requirement. Luna's macOS artifacts are ad-hoc signed — there is no Developer
 * ID identity and `notarize: false` in electron-builder.yml — so that check can
 * never pass: the download completes, `quitAndInstall` runs, and Squirrel
 * reports "Code signature at URL ... did not pass validation". Offering
 * "Download" and "Restart now" in that situation walks the user into a failure
 * that no amount of retrying fixes.
 *
 * `codesign --display` tells us which case we are in. A bundle signed with a
 * real certificate prints one or more `Authority=` lines; an ad-hoc signature
 * prints `Signature=adhoc` and no authority; an unsigned bundle exits non-zero
 * with "code object is not signed at all".
 *
 * Windows (NSIS) and Linux (AppImage) install unsigned updates fine, so they
 * short-circuit to `true`.
 *
 * A `false` here is not the end of the road: `mac-self-update.ts` takes over
 * and replaces the bundle without Squirrel, verifying the download against the
 * feed's SHA-512 instead of a signature chain. Only when that is impossible
 * too (see `isSelfInstallSupported`) is the user sent to GitHub.
 *
 * Fails closed: any unexpected error means we do not hand the bundle to
 * Squirrel, since an install that cannot work is worse than one route down.
 */
function detectAutoInstallSupport(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(true);

  // process.execPath is <bundle>/Contents/MacOS/Luna — walk back up to the .app.
  const bundlePath = resolve(dirname(process.execPath), '..', '..');

  return execFileAsync('/usr/bin/codesign', ['--display', '--verbose=2', bundlePath], {
    timeout: 10_000,
  })
    .then(({ stderr }) => {
      // codesign writes its report to stderr, not stdout.
      const signedByAuthority = /^Authority=/m.test(stderr) && !/^Signature=adhoc$/m.test(stderr);
      if (!signedByAuthority) {
        log.warn('[Updater] Bundle is not signed with a developer certificate; auto-install off.');
      }
      return signedByAuthority;
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('[Updater] Could not read the bundle code signature; auto-install off:', msg);
      return false;
    });
}

/** Memoized: `codesign` spawns a process, and the answer cannot change at runtime. */
function isAutoInstallSupported(): Promise<boolean> {
  autoInstallSupport ??= detectAutoInstallSupport();
  return autoInstallSupport;
}

/**
 * Which of the three install routes this build gets.
 *
 * Order matters: Squirrel first wherever it can work, because it is the
 * platform's own mechanism and validates the signature chain. The in-place
 * replace is the fallback for ad-hoc macOS builds, and GitHub the fallback
 * for that — an app the user cannot write to (installed by an admin, or
 * running translocated) can only be updated by hand.
 */
async function resolveUpdateMode(): Promise<UpdateMode> {
  if (!app.isPackaged) return 'squirrel';
  if (await isAutoInstallSupported()) return 'squirrel';
  if (await isSelfInstallSupported()) return 'self';
  return 'manual';
}

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

  // Start the signature probe now so the answer is ready by the time the first
  // feed check resolves; nothing below blocks on it.
  void isAutoInstallSupported();

  // A staged bundle is a few hundred megabytes; one abandoned by a previous
  // run (downloaded but never applied, or an apply that died) would otherwise
  // sit in the temp directory forever.
  void cleanupStaleStageDirs();

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  // An update staged for install-on-quit hits the same Squirrel validation as
  // an explicit install, so only arm it where installing can actually succeed.
  autoUpdater.autoInstallOnAppQuit = false;
  void isAutoInstallSupported().then((supported) => {
    autoUpdater.autoInstallOnAppQuit = supported;
  });
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
    // The feed's file list (names, sizes, SHA-512s) is what the self-installer
    // downloads and verifies against, so keep it for `installUpdate`.
    pendingUpdateInfo = { version: info.version, files: info.files };
    // `manual` tells the renderer to offer a GitHub download instead of an
    // in-app install it cannot complete.
    void resolveUpdateMode().then((mode) => {
      emitToRenderer(IPC.APP_UPDATE_AVAILABLE, {
        version: info.version,
        manual: mode === 'manual',
      });
    });
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
      errorMessage = MANUAL_UPDATE_MESSAGE;
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
 *
 * `manual` is true only when this build can neither install an update through
 * Squirrel nor replace its own bundle — see `resolveUpdateMode`.
 */
export async function checkForUpdate(): Promise<{
  available: boolean;
  version?: string;
  manual: boolean;
}> {
  try {
    await checkOnce();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('[Updater] Manual check failed:', msg);
  }
  const manual = (await resolveUpdateMode()) === 'manual';
  return { available: updateAvailable, version: updateVersion || undefined, manual };
}

/** Opens the GitHub releases page — the fallback when this build can't self-install. */
export async function openReleasePage(): Promise<void> {
  await shell.openExternal(RELEASES_URL);
}

export async function installUpdate(): Promise<void> {
  // Same guard as initAutoUpdater — a renderer that calls install in an
  // unpackaged build must not be able to coerce the updater into running.
  if (!app.isPackaged) {
    log.warn('[Updater] Refusing installUpdate: app is not packaged.');
    return;
  }

  const mode = await resolveUpdateMode();

  // Belt-and-braces: the renderer is told up front (via `manual`) not to offer
  // an install here, but a stale toast from before the probe resolved must not
  // start a download that ends nowhere.
  if (mode === 'manual') {
    log.warn('[Updater] Refusing installUpdate: build cannot install its own updates.');
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: MANUAL_UPDATE_MESSAGE });
    return;
  }

  if (mode === 'self') {
    await installBySelfReplace();
    return;
  }

  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall(false, true);
  } catch (err: unknown) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    if (
      errorMessage.includes('code signature at URL') ||
      errorMessage.includes('did not pass validation')
    ) {
      errorMessage = MANUAL_UPDATE_MESSAGE;
    }
    log.error('[Updater] Failed to download update:', errorMessage);
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage });
  }
}

/**
 * The ad-hoc macOS install, driven by the same two toast presses as the
 * Squirrel one: the first stages the update, the second applies it.
 *
 * Splitting it that way is what lets the renderer keep a single flow —
 * "Download" → progress → "Restart now" — regardless of which mechanism is
 * doing the work underneath.
 */
async function installBySelfReplace(): Promise<void> {
  if (hasStagedUpdate()) {
    // Second press ("Restart now"): the verified bundle is already unpacked,
    // so hand it to the detached helper and get out of its way — it cannot
    // move the bundle until this process is gone.
    if (!applyStagedUpdate({ relaunch: true })) {
      emitToRenderer(IPC.APP_UPDATE_ERROR, { error: MANUAL_UPDATE_MESSAGE });
      return;
    }
    app.quit();
    return;
  }

  if (selfInstallInFlight) {
    log.info('[Updater] Download already in progress; ignoring the repeat request.');
    return;
  }

  if (!pendingUpdateInfo) {
    emitToRenderer(IPC.APP_UPDATE_ERROR, {
      error: 'No update is ready to download. Check for updates again.',
    });
    return;
  }

  selfInstallInFlight = true;
  try {
    await stageUpdate(pendingUpdateInfo, (percent, bytesPerSecond) => {
      emitToRenderer(IPC.APP_UPDATE_DOWNLOAD_PROGRESS, { percent, bytesPerSecond });
    });
    emitToRenderer(IPC.APP_UPDATE_DOWNLOADED, {});
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error('[Updater] In-place update failed:', errorMessage);
    emitToRenderer(IPC.APP_UPDATE_ERROR, { error: errorMessage });
  } finally {
    selfInstallInFlight = false;
  }
}
