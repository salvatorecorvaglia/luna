import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `checkForUpdate()` used to fire the check and return the module-level state
 * synchronously, without awaiting — so it could only ever report the outcome
 * of a check that had *already* finished. The first call always said "no
 * update available", whatever the feed contained.
 */

let isPackaged = true;
const listeners = new Map<string, (payload: unknown) => void>();
const checkForUpdates = vi.fn(() => Promise.resolve(null as unknown));

vi.mock('electron', () => ({
  get app() {
    return { isPackaged };
  },
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
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock('../emit', () => ({ emitToRenderer: vi.fn() }));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * `updater.ts` keeps `updateAvailable` / `updateVersion` at module scope, so a
 * result recorded by one test would otherwise be visible to the next. Reset
 * the module registry and re-import per test to get a clean instance.
 */
async function freshUpdater(): Promise<typeof import('../updater')> {
  vi.resetModules();
  listeners.clear();
  const mod = await import('../updater');
  // initAutoUpdater schedules a 5s startup check; fake timers keep it from
  // firing into the assertions below.
  vi.useFakeTimers();
  mod.initAutoUpdater();
  vi.useRealTimers();
  return mod;
}

beforeEach(() => {
  isPackaged = true;
  checkForUpdates.mockClear();
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

    await expect(checkForUpdate()).resolves.toEqual({ available: true, version: '2.0.0' });
  });

  it('reports no update when the feed says so', async () => {
    const { checkForUpdate } = await freshUpdater();
    checkForUpdates.mockImplementationOnce(async () => {
      listeners.get('update-not-available')?.({});
      return null;
    });

    await expect(checkForUpdate()).resolves.toEqual({ available: false, version: undefined });
  });

  it('resolves rather than rejecting when the check fails', async () => {
    // A transient network error should read as "nothing new right now", not
    // as an error dialog the user can't act on.
    const { checkForUpdate } = await freshUpdater();
    checkForUpdates.mockImplementationOnce(() => Promise.reject(new Error('ENOTFOUND')));
    await expect(checkForUpdate()).resolves.toEqual({ available: false, version: undefined });
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
    await expect(checkForUpdate()).resolves.toEqual({ available: false, version: undefined });
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});
