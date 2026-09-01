import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `checkForUpdate()` used to fire the check and return the module-level state
 * synchronously, without awaiting — so it could only ever report the outcome
 * of a check that had *already* finished. The first call always said "no
 * update available", whatever the feed contained.
 */

let isPackaged = true;
let platform: NodeJS.Platform = 'linux';
/** stderr `codesign --display` writes for the bundle under test. */
let codesignStderr = 'Authority=Developer ID Application: Someone (ABCDE12345)\n';
let codesignError: Error | null = null;
const listeners = new Map<string, (payload: unknown) => void>();
const checkForUpdates = vi.fn(() => Promise.resolve(null as unknown));
const openExternal = vi.fn((_url: string) => Promise.resolve());
const downloadUpdate = vi.fn(() => Promise.resolve());
const quitAndInstall = vi.fn();
const emitToRenderer = vi.fn();

// `execFile` is consumed through `promisify`, so the double has to carry the
// custom-promisified symbol the same way node's own `execFile` does.
const execFile = Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: () =>
    codesignError
      ? Promise.reject(codesignError)
      : Promise.resolve({ stdout: '', stderr: codesignStderr }),
});

vi.mock('node:child_process', () => ({
  get execFile() {
    return execFile;
  },
}));

vi.mock('electron', () => ({
  get app() {
    return { isPackaged };
  },
  shell: { openExternal: (url: string) => openExternal(url) },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    // biome-ignore lint/suspicious/noExplicitAny: test double mirrors the SDK's loose surface
    set logger(_v: any) {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    allowPrerelease: false,
    disableDifferentialDownload: false,
    on: (event: string, cb: (payload: unknown) => void) => {
      listeners.set(event, cb);
    },
    checkForUpdates: () => checkForUpdates(),
    downloadUpdate: () => downloadUpdate(),
    quitAndInstall: (...args: unknown[]) => quitAndInstall(...args),
  },
}));

vi.mock('../../../src/main/services/emit', () => ({
  emitToRenderer: (...args: unknown[]) => emitToRenderer(...args),
}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * `updater.ts` keeps `updateAvailable` / `updateVersion` at module scope, so a
 * result recorded by one test would otherwise be visible to the next. Reset
 * the module registry and re-import per test to get a clean instance.
 */
async function freshUpdater(): Promise<typeof import('../../../src/main/services/updater')> {
  vi.resetModules();
  listeners.clear();
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  const mod = await import('../../../src/main/services/updater');
  // initAutoUpdater schedules a 5s startup check; fake timers keep it from
  // firing into the assertions below.
  vi.useFakeTimers();
  mod.initAutoUpdater();
  vi.useRealTimers();
  return mod;
}

const realPlatform = process.platform;

beforeEach(() => {
  isPackaged = true;
  platform = 'linux';
  codesignStderr = 'Authority=Developer ID Application: Someone (ABCDE12345)\n';
  codesignError = null;
  checkForUpdates.mockClear();
  openExternal.mockClear();
  downloadUpdate.mockClear();
  quitAndInstall.mockClear();
  emitToRenderer.mockClear();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
});

describe('checkForUpdate', () => {
  it('awaits the check before reporting, so a fresh result is visible', async () => {
    // The feed resolves *and* fires update-available while the promise is in
    // flight — exactly the ordering electron-updater produces. A synchronous
    // return would miss it and report "no update".
    const { checkForUpdate } = await freshUpdater();
    checkForUpdates.mockImplementationOnce(async () => {
      listeners.get('update-available')?.({ version: '2.0.0' });
      return null;
    });

    await expect(checkForUpdate()).resolves.toEqual({
      available: true,
      version: '2.0.0',
      manual: false,
    });
  });

  it('reports no update when the feed says so', async () => {
    const { checkForUpdate } = await freshUpdater();
    checkForUpdates.mockImplementationOnce(async () => {
      listeners.get('update-not-available')?.({});
      return null;
    });

    await expect(checkForUpdate()).resolves.toEqual({
      available: false,
      version: undefined,
      manual: false,
    });
  });

  it('resolves rather than rejecting when the check fails', async () => {
    // A transient network error should read as "nothing new right now", not
    // as an error dialog the user can't act on.
    const { checkForUpdate } = await freshUpdater();
    checkForUpdates.mockImplementationOnce(() => Promise.reject(new Error('ENOTFOUND')));
    await expect(checkForUpdate()).resolves.toEqual({
      available: false,
      version: undefined,
      manual: false,
    });
  });

  it('coalesces concurrent checks into one network call', async () => {
    const { checkForUpdate } = await freshUpdater();
    let release: (() => void) | undefined;
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );

    const a = checkForUpdate();
    const b = checkForUpdate();
    release?.();
    await Promise.all([a, b]);

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('is inert in an unpackaged build', async () => {
    isPackaged = false;
    const { checkForUpdate } = await freshUpdater();
    await expect(checkForUpdate()).resolves.toEqual({
      available: false,
      version: undefined,
      manual: false,
    });
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});

/**
 * An ad-hoc-signed macOS bundle cannot pass Squirrel's signature check, so the
 * app must not walk the user through "Download" → "Restart now" → failure.
 */
describe('unsigned macOS builds', () => {
  it('reports manual mode when the bundle has no signing authority', async () => {
    platform = 'darwin';
    codesignStderr = 'Executable=/Applications/Luna.app\nSignature=adhoc\n';
    const { checkForUpdate } = await freshUpdater();

    await expect(checkForUpdate()).resolves.toMatchObject({ manual: true });
  });

  it('reports manual mode when codesign cannot read the bundle at all', async () => {
    platform = 'darwin';
    codesignError = new Error('code object is not signed at all');
    const { checkForUpdate } = await freshUpdater();

    await expect(checkForUpdate()).resolves.toMatchObject({ manual: true });
  });

  it('stays in auto mode for a properly signed bundle', async () => {
    platform = 'darwin';
    const { checkForUpdate } = await freshUpdater();

    await expect(checkForUpdate()).resolves.toMatchObject({ manual: false });
  });

  it('flags the update-available event as manual so the UI offers GitHub', async () => {
    platform = 'darwin';
    codesignStderr = 'Signature=adhoc\n';
    await freshUpdater();

    listeners.get('update-available')?.({ version: '2.0.0' });
    await vi.waitFor(() => {
      expect(emitToRenderer).toHaveBeenCalledWith('app:update-available', {
        version: '2.0.0',
        manual: true,
      });
    });
  });

  it('refuses to download an update it could never install', async () => {
    platform = 'darwin';
    codesignStderr = 'Signature=adhoc\n';
    const { installUpdate } = await freshUpdater();

    await installUpdate();

    expect(downloadUpdate).not.toHaveBeenCalled();
    expect(quitAndInstall).not.toHaveBeenCalled();
    expect(emitToRenderer).toHaveBeenCalledWith(
      'app:update-error',
      expect.objectContaining({ error: expect.stringContaining('GitHub') }),
    );
  });

  it('downloads and installs normally when the bundle is signed', async () => {
    platform = 'darwin';
    const { installUpdate } = await freshUpdater();

    await installUpdate();

    expect(downloadUpdate).toHaveBeenCalled();
    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});

describe('openReleasePage', () => {
  it('opens the GitHub releases page', async () => {
    const { openReleasePage, RELEASES_URL } = await freshUpdater();
    await openReleasePage();
    expect(openExternal).toHaveBeenCalledWith(RELEASES_URL);
  });
});
