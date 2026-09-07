import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, constants as fsConstants, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { app, net } from 'electron';
import log from '../lib/logger';
import { RELEASE_ASSET_ORIGIN, releaseAssetUrl } from './release';

const execFileAsync = promisify(execFile);

/**
 * In-app updates for ad-hoc-signed macOS builds.
 *
 * Squirrel.Mac — the mechanism electron-updater drives — refuses to swap in a
 * bundle whose signature does not satisfy the *running* app's designated
 * requirement, and Luna's macOS artifacts are ad-hoc signed (`identity: '-'`,
 * `notarize: false` in electron-builder.yml). No Developer ID certificate
 * means that check can never pass, which is why `updater.ts` keeps
 * `autoInstallOnAppQuit` off and never calls `quitAndInstall` on these builds.
 *
 * What Squirrel adds over a plain replace is signature-chain validation, and
 * on an ad-hoc build there is no chain to validate — so this module does the
 * swap itself and takes the integrity guarantee from somewhere else: the
 * SHA-512 that electron-updater already read out of `latest-mac.yml` over
 * HTTPS. The zip is fetched from github.com, hashed while it streams, and
 * rejected unless the digest matches the feed byte for byte. Only then is it
 * unpacked and moved over the installed bundle by a small detached script that
 * waits for this process to exit.
 *
 * This is deliberately *not* a substitute for signing. It closes the gap for a
 * development build the user already had to `xattr -cr` by hand; a build with
 * a real certificate goes back through Squirrel automatically (see
 * `detectAutoInstallSupport` in `updater.ts`).
 */

/** Prefix for the temp directories a staged update lives in. */
const STAGE_PREFIX = 'luna-update-';

/** Hard ceiling when the feed does not tell us how big the asset is (~1 GiB). */
const MAX_UNKNOWN_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

/** How often download progress reaches the renderer. Enough for a smooth bar. */
const PROGRESS_INTERVAL_MS = 250;

/** One entry of the `files:` list in `latest-mac.yml`. */
export interface UpdateAsset {
  url: string;
  sha512?: string;
  size?: number;
}

/** The subset of electron-updater's `UpdateInfo` this module needs. */
export interface SelfUpdateInfo {
  version: string;
  files?: UpdateAsset[];
}

export interface StagedUpdate {
  version: string;
  /** The unpacked `.app` waiting in the stage directory. */
  appPath: string;
  /** Temp directory holding the download and the unpacked bundle. */
  stageDir: string;
}

let staged: StagedUpdate | null = null;
let applying = false;
let quitHookArmed = false;
let selfInstallSupport: Promise<boolean> | null = null;

/**
 * The installed `.app` this process is running from.
 *
 * `process.execPath` is `<bundle>/Contents/MacOS/Luna`, so the bundle is two
 * levels up. Returns null when that does not look like an app bundle — an
 * unpackaged dev run, or a binary someone lifted out of its bundle.
 *
 * The path helpers are pinned to `posix`: these are macOS paths whichever host
 * the code is parsed on, and the platform-sensitive versions mangle them into
 * drive-prefixed backslash paths when the test suite runs on Windows.
 */
export function getBundlePath(): string | null {
  if (process.platform !== 'darwin') return null;
  const bundlePath = posix.resolve(posix.dirname(process.execPath), '..', '..');
  if (!bundlePath.endsWith('.app')) return null;
  // A bundle with fewer than two segments below root ("/Luna.app") would make
  // the replace step operate dangerously close to the filesystem root.
  if (bundlePath.split('/').filter(Boolean).length < 2) return null;
  return bundlePath;
}

/**
 * Can this build replace its own bundle in place?
 *
 * Three ways it cannot, all of which must route the user to GitHub instead:
 * the app is not packaged; it is running translocated (Gatekeeper's read-only
 * shadow copy under `AppTranslocation`, where the real bundle is elsewhere);
 * or the bundle and its parent directory are not writable by this user — an
 * app installed into `/Applications` by an admin, for one.
 */
function detectSelfInstallSupport(): Promise<boolean> {
  const bundlePath = getBundlePath();
  if (!app.isPackaged || !bundlePath) return Promise.resolve(false);

  if (bundlePath.includes('/AppTranslocation/')) {
    log.warn('[SelfUpdate] Running translocated; in-place update is not possible.');
    return Promise.resolve(false);
  }

  return Promise.all([
    access(bundlePath, fsConstants.W_OK),
    access(posix.dirname(bundlePath), fsConstants.W_OK),
  ])
    .then(() => true)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('[SelfUpdate] Bundle location is not writable; in-place update off:', msg);
      return false;
    });
}

/** Memoized: the answer cannot change while the app runs. */
export function isSelfInstallSupported(): Promise<boolean> {
  selfInstallSupport ??= detectSelfInstallSupport();
  return selfInstallSupport;
}

export function hasStagedUpdate(): boolean {
  return staged !== null;
}

/**
 * Pick the macOS zip for the architecture we are running.
 *
 * The feed lists both arches plus the dmgs; installing the wrong slice would
 * produce an app that launches under Rosetta at best. Only `.zip` is usable —
 * a dmg would need mounting — and the arch has to match exactly, so a feed
 * that somehow lists neither is a hard error rather than a guess.
 */
export function selectMacAsset(info: SelfUpdateInfo, arch: string = process.arch): UpdateAsset {
  const files = info.files ?? [];
  const wanted = arch === 'arm64' ? 'arm64' : 'x64';
  const asset = files.find((f) => f.url.endsWith('.zip') && f.url.includes(`-mac-${wanted}.`));
  if (!asset) {
    throw new Error(`The release has no macOS ${wanted} package to download.`);
  }
  if (!asset.sha512) {
    // Without the feed's digest there is nothing to verify the download
    // against, and an unverified bundle must never be unpacked over the app.
    throw new Error('The update feed did not publish a checksum for this package.');
  }
  return asset;
}

/** Streams `url` to `destPath`, returning the base64 SHA-512 of what arrived. */
function downloadAsset(
  url: string,
  destPath: string,
  expectedSize: number | undefined,
  onProgress: (percent: number, bytesPerSecond: number) => void,
): Promise<string> {
  if (!url.startsWith(`${RELEASE_ASSET_ORIGIN}/`)) {
    return Promise.reject(new Error('Refusing to download an update from an unexpected host.'));
  }

  return new Promise<string>((resolvePromise, rejectPromise) => {
    const request = net.request({ method: 'GET', url, redirect: 'follow' });
    const hash = createHash('sha512');
    const file = createWriteStream(destPath);
    const limit = expectedSize ?? MAX_UNKNOWN_DOWNLOAD_BYTES;
    const startedAt = Date.now();
    let received = 0;
    let lastReport = 0;
    let settled = false;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      file.destroy();
      request.abort();
      rejectPromise(err instanceof Error ? err : new Error(String(err)));
    };

    file.on('error', fail);
    request.on('error', fail);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`Download failed (HTTP ${response.statusCode}).`));
        return;
      }

      // Electron's `IncomingMessage` is a Readable at runtime but its typings
      // omit the flow controls, and a ~200 MB asset arriving faster than the
      // disk drains would otherwise pile up in the write stream's buffer.
      const flow = response as unknown as { pause(): void; resume(): void };

      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        // The feed states the exact size; anything longer is not the asset the
        // checksum describes, so stop rather than filling the disk.
        if (received > limit) {
          fail(new Error('The update package is larger than the feed declared.'));
          return;
        }
        hash.update(chunk);
        if (!file.write(chunk)) {
          flow.pause();
          file.once('drain', () => flow.resume());
        }
        const now = Date.now();
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now;
          const elapsed = Math.max(now - startedAt, 1) / 1000;
          onProgress(expectedSize ? (received / expectedSize) * 100 : 0, received / elapsed);
        }
      });

      response.on('error', fail);

      response.on('end', () => {
        if (settled) return;
        if (expectedSize !== undefined && received !== expectedSize) {
          fail(new Error('The update package download ended early.'));
          return;
        }
        file.end(() => {
          if (settled) return;
          settled = true;
          resolvePromise(hash.digest('base64'));
        });
      });
    });

    request.end();
  });
}

/** Reads one key out of an Info.plist. Returns null if the key is absent. */
async function readPlistValue(bundlePath: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/plutil',
      ['-extract', key, 'raw', '-o', '-', join(bundlePath, 'Contents', 'Info.plist')],
      { timeout: 10_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Refuse to install anything that is not a newer copy of *this* app.
 *
 * The digest already proves the zip is the artifact the feed describes; this
 * catches the feed itself pointing at the wrong thing — a mismatched version,
 * or a bundle belonging to some other application.
 */
async function assertReplacementIsLuna(candidate: string, expectedVersion: string): Promise<void> {
  const installed = getBundlePath();
  const expectedId = installed ? await readPlistValue(installed, 'CFBundleIdentifier') : null;
  const candidateId = await readPlistValue(candidate, 'CFBundleIdentifier');

  if (expectedId && candidateId !== expectedId) {
    throw new Error('The downloaded package is not a Luna build.');
  }

  const candidateVersion = await readPlistValue(candidate, 'CFBundleShortVersionString');
  if (candidateVersion && candidateVersion !== expectedVersion) {
    throw new Error(
      `The downloaded package is version ${candidateVersion}, not ${expectedVersion}.`,
    );
  }
}

/**
 * Download, verify and unpack the update, leaving it ready to swap in.
 *
 * Nothing outside the temp stage directory is touched here — the installed
 * bundle is only replaced by `applyStagedUpdate`, after the user asks for it
 * or on quit.
 */
export async function stageUpdate(
  info: SelfUpdateInfo,
  onProgress: (percent: number, bytesPerSecond: number) => void,
): Promise<StagedUpdate> {
  if (staged?.version === info.version) return staged;
  await discardStagedUpdate();

  const asset = selectMacAsset(info);
  const stageDir = await mkdtemp(join(tmpdir(), STAGE_PREFIX));

  try {
    const zipPath = join(stageDir, 'update.zip');
    const digest = await downloadAsset(
      releaseAssetUrl(info.version, asset.url),
      zipPath,
      asset.size,
      onProgress,
    );

    if (digest !== asset.sha512) {
      throw new Error('The update package failed its checksum check and was discarded.');
    }

    const unpackDir = join(stageDir, 'unpacked');
    // `ditto -x -k` is the only unzip on macOS that preserves symlinks and the
    // extended attributes a signed bundle needs; `unzip` corrupts frameworks.
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', zipPath, unpackDir], {
      timeout: 300_000,
    });
    await rm(zipPath, { force: true });

    const entries = await readdir(unpackDir);
    const appName = entries.find((entry) => entry.endsWith('.app'));
    if (!appName) throw new Error('The update package did not contain an app bundle.');

    const appPath = join(unpackDir, appName);
    await assertReplacementIsLuna(appPath, info.version);

    staged = { version: info.version, appPath, stageDir };
    armApplyOnQuit();
    log.info(`[SelfUpdate] Staged v${info.version} at ${appPath}`);
    return staged;
  } catch (err) {
    await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** Single-quote a path for safe interpolation into the apply script. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Where the detached script leaves its trace when a swap goes wrong. */
function applyLogPath(): string {
  try {
    return join(app.getPath('logs'), 'update-apply.log');
  } catch {
    return join(tmpdir(), 'luna-update-apply.log');
  }
}

/**
 * The swap, as a shell script run by a process that outlives us.
 *
 * It has to happen from outside: the bundle being replaced is the one this
 * process is executing from, so the move can only be safe once we have exited.
 * The script therefore waits on our PID, keeps the old bundle aside until the
 * copy has succeeded so a failure rolls back to a working app, and clears the
 * quarantine attributes an ad-hoc build would otherwise be blocked by — the
 * `xattr -cr` step users currently run by hand after downloading from GitHub.
 */
export function buildApplyScript(
  pid: number,
  stagedAppPath: string,
  targetPath: string,
  stageDir: string,
  relaunch: boolean,
): string {
  const source = shellQuote(stagedAppPath);
  const target = shellQuote(targetPath);
  const stage = shellQuote(stageDir);
  const logFile = shellQuote(applyLogPath());

  return `#!/bin/bash
set -u
exec >>${logFile} 2>&1
echo "[luna-update] $(date '+%Y-%m-%dT%H:%M:%S') applying update"

# Wait for Luna to exit (up to 30s) — the bundle cannot be moved while it runs.
i=0
while /bin/kill -0 ${pid} 2>/dev/null && [ $i -lt 300 ]; do
  /bin/sleep 0.1
  i=$((i+1))
done
if /bin/kill -0 ${pid} 2>/dev/null; then
  echo "[luna-update] app is still running; aborting"
  /bin/rm -rf ${stage}
  exit 1
fi
/bin/sleep 0.5

BACKUP=${target}.old-$$
if ! /bin/mv ${target} "$BACKUP"; then
  echo "[luna-update] could not move the installed app aside"
  /bin/rm -rf ${stage}
  exit 1
fi
if ! /usr/bin/ditto ${source} ${target}; then
  echo "[luna-update] copy failed; rolling back"
  /bin/rm -rf ${target}
  /bin/mv "$BACKUP" ${target}
  /bin/rm -rf ${stage}
  exit 1
fi
/usr/bin/xattr -cr ${target} || true
/bin/rm -rf "$BACKUP"
/bin/rm -rf ${stage}
echo "[luna-update] done"
${relaunch ? `/usr/bin/open ${target}` : ''}
`;
}

/**
 * Hand the staged update to a detached process and let it finish after we go.
 *
 * Returns false when there is nothing staged or the swap cannot be attempted,
 * so callers can fall back to sending the user to GitHub.
 */
export function applyStagedUpdate({ relaunch }: { relaunch: boolean }): boolean {
  if (!staged || applying) return false;
  const target = getBundlePath();
  if (!target) return false;

  applying = true;
  const script = buildApplyScript(process.pid, staged.appPath, target, staged.stageDir, relaunch);

  try {
    // Detached with no stdio: the script must survive this process exiting,
    // which is the entire point — it cannot do its job until we are gone.
    const child = spawn('/bin/bash', ['-c', script], { detached: true, stdio: 'ignore' });
    child.unref();
    log.info(`[SelfUpdate] Apply helper started for v${staged.version} (relaunch=${relaunch}).`);
    return true;
  } catch (err: unknown) {
    applying = false;
    const msg = err instanceof Error ? err.message : String(err);
    log.error('[SelfUpdate] Could not start the apply helper:', msg);
    return false;
  }
}

/**
 * Apply on quit, mirroring electron-updater's `autoInstallOnAppQuit`.
 *
 * Without this the toast's "Luna will update when you restart the app" would
 * be a lie for these builds: a user who quits normally instead of pressing
 * "Restart now" would come back to the old version and a discarded download.
 * No relaunch here — the user asked to quit.
 */
function armApplyOnQuit(): void {
  if (quitHookArmed) return;
  quitHookArmed = true;
  app.on('before-quit', () => {
    applyStagedUpdate({ relaunch: false });
  });
}

/** Drops the staged download. Safe to call when nothing is staged. */
export async function discardStagedUpdate(): Promise<void> {
  if (!staged) return;
  const { stageDir } = staged;
  staged = null;
  await rm(stageDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Sweep stage directories a previous run left behind — an update downloaded
 * but never applied, or an apply that died before its cleanup. They are whole
 * app bundles, so leaving them around costs hundreds of megabytes each.
 */
export async function cleanupStaleStageDirs(): Promise<void> {
  if (process.platform !== 'darwin') return;
  try {
    const temp = tmpdir();
    const entries = await readdir(temp);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith(STAGE_PREFIX))
        .filter((entry) => join(temp, entry) !== staged?.stageDir)
        .map((entry) => rm(join(temp, entry), { recursive: true, force: true }).catch(() => {})),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('[SelfUpdate] Could not sweep stale update directories:', msg);
  }
}
