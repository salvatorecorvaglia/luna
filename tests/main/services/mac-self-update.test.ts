import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

/** The `bash -n` check needs a real bash; the Windows CI runner has none. */
const hasBash = existsSync('/bin/bash');

/**
 * The in-place updater is the only path an ad-hoc-signed macOS build has, and
 * every step of it runs with real authority — it unpacks a download over the
 * installed app bundle. These tests pin the guards that decide whether it may
 * run at all, and the exact shell the swap is performed by.
 */

let isPackaged = true;
const getPath = vi.fn(() => '/Users/someone/Library/Logs/Luna');

vi.mock('electron', () => ({
  get app() {
    return { isPackaged, getPath, on: vi.fn() };
  },
  net: { request: vi.fn() },
}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Writability of the install location is an input to the code under test, so
 * the test has to control it — not inherit it from whatever machine is running.
 *
 * This test previously asserted `false` and relied on `/Applications/Luna.app`
 * not existing, with a comment saying so. That holds on a CI runner and fails on
 * any developer machine with Luna actually installed: the W_OK probe then
 * succeeds, `isSelfInstallSupported()` correctly returns `true`, and the suite
 * goes red over a property of the filesystem rather than a property of the code.
 *
 * Only `access` is replaced; the rest of node:fs/promises stays real because
 * this module also uses mkdtemp/readdir/rm.
 */
const accessMock = vi.fn<(path: string, mode?: number) => Promise<void>>();

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, access: (path: string, mode?: number) => accessMock(path, mode) };
});

const realPlatform = process.platform;
const realExecPath = process.execPath;

function setEnvironment(platform: NodeJS.Platform, execPath: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'execPath', { value: execPath, configurable: true });
}

async function freshModule(): Promise<typeof import('../../../src/main/services/mac-self-update')> {
  vi.resetModules();
  return import('../../../src/main/services/mac-self-update');
}

beforeEach(() => {
  isPackaged = true;
  setEnvironment('darwin', '/Applications/Luna.app/Contents/MacOS/Luna');
  // Default: the bundle and its parent are writable. Tests that care override.
  accessMock.mockReset();
  accessMock.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  Object.defineProperty(process, 'execPath', { value: realExecPath, configurable: true });
});

describe('getBundlePath', () => {
  it('walks back from the executable to the .app', async () => {
    const { getBundlePath } = await freshModule();
    expect(getBundlePath()).toBe('/Applications/Luna.app');
  });

  it('returns null when the binary is not inside a bundle', async () => {
    setEnvironment('darwin', '/usr/local/bin/luna');
    const { getBundlePath } = await freshModule();
    expect(getBundlePath()).toBeNull();
  });

  it('returns null off macOS', async () => {
    setEnvironment('linux', '/opt/Luna/luna');
    const { getBundlePath } = await freshModule();
    expect(getBundlePath()).toBeNull();
  });
});

describe('isSelfInstallSupported', () => {
  it('is false in an unpackaged build', async () => {
    isPackaged = false;
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(false);
  });

  it('is false when running translocated, where the real bundle is elsewhere', async () => {
    setEnvironment(
      'darwin',
      '/private/var/folders/x/AppTranslocation/ABC/d/Luna.app/Contents/MacOS/Luna',
    );
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(false);
  });

  it('is false when the install location is not writable by this user', async () => {
    // An admin-installed app the current user cannot touch, or a bundle that
    // is not there at all — both surface as a rejected W_OK probe.
    accessMock.mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(false);
  });

  it('is false when the bundle is writable but its parent directory is not', async () => {
    // Both probes have to pass: the swap replaces the bundle *inside* its
    // parent, so a read-only /Applications defeats it even when the bundle
    // itself is writable.
    accessMock.mockImplementation((path: string) =>
      path === '/Applications'
        ? Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
        : Promise.resolve(),
    );
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(false);
  });

  it('is true for a packaged, non-translocated, writable bundle', async () => {
    // The positive case had no test at all, so nothing pinned the one
    // configuration in which the in-place updater is allowed to run.
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(true);
    expect(accessMock).toHaveBeenCalledWith('/Applications/Luna.app', expect.any(Number));
    expect(accessMock).toHaveBeenCalledWith('/Applications', expect.any(Number));
  });
});

describe('selectMacAsset', () => {
  const dmg = { url: 'luna-1.6.0-mac-arm64.dmg', sha512: 'dmg-digest', size: 213_936_288 };
  const info = {
    version: '1.6.0',
    files: [
      { url: 'luna-1.6.0-mac-x64.zip', sha512: 'x64-digest', size: 156_062_189 },
      { url: 'luna-1.6.0-mac-arm64.zip', sha512: 'arm-digest', size: 213_472_136 },
      dmg,
    ],
  };

  it('picks the zip for the running architecture', async () => {
    const { selectMacAsset } = await freshModule();
    expect(selectMacAsset(info, 'arm64').url).toBe('luna-1.6.0-mac-arm64.zip');
    expect(selectMacAsset(info, 'x64').url).toBe('luna-1.6.0-mac-x64.zip');
  });

  it('never picks a dmg, which cannot be unpacked in place', async () => {
    const { selectMacAsset } = await freshModule();
    const dmgOnly = { version: '1.6.0', files: [dmg] };
    expect(() => selectMacAsset(dmgOnly, 'arm64')).toThrow(/no macOS arm64 package/);
  });

  it('refuses an asset the feed published no checksum for', async () => {
    // Without the digest there is nothing to verify the bytes against, and an
    // unverified bundle must never be unpacked over the installed app.
    const { selectMacAsset } = await freshModule();
    const noDigest = { version: '1.6.0', files: [{ url: 'luna-1.6.0-mac-arm64.zip' }] };
    expect(() => selectMacAsset(noDigest, 'arm64')).toThrow(/checksum/);
  });
});

describe('buildApplyScript', () => {
  it('waits for the app to exit, swaps with a rollback, and clears quarantine', async () => {
    const { buildApplyScript } = await freshModule();
    const script = buildApplyScript(
      4242,
      '/tmp/luna-update-abc/unpacked/Luna.app',
      '/Applications/Luna.app',
      '/tmp/luna-update-abc',
      true,
    );

    // The bundle cannot be moved while this process is executing from it.
    expect(script).toContain('/bin/kill -0 4242');
    // Old bundle kept aside until the copy succeeds, so a failure rolls back.
    expect(script).toContain('BACKUP=');
    expect(script).toContain('/bin/mv "$BACKUP"');
    expect(script).toContain("/usr/bin/ditto '/tmp/luna-update-abc/unpacked/Luna.app'");
    // The `xattr -cr` users currently run by hand after a GitHub download.
    expect(script).toContain("/usr/bin/xattr -cr '/Applications/Luna.app'");
    expect(script).toContain("/usr/bin/open '/Applications/Luna.app'");
  });

  it('does not relaunch when the update is applied on quit', async () => {
    const { buildApplyScript } = await freshModule();
    const script = buildApplyScript(
      1,
      '/tmp/s/Luna.app',
      '/Applications/Luna.app',
      '/tmp/s',
      false,
    );
    expect(script).not.toContain('/usr/bin/open');
  });

  it.skipIf(!hasBash)(
    'is valid bash — a syntax slip here would fail silently after the app quits',
    async () => {
      const { buildApplyScript } = await freshModule();
      const script = buildApplyScript(
        1,
        "/tmp/it's here/Luna.app",
        '/Users/someone/My Apps/Luna.app',
        '/tmp/stage',
        true,
      );

      // The helper runs detached with no stdio once Luna is gone, so nothing
      // would surface a parse error; `bash -n` is the only chance to catch it.
      await expect(execFileAsync('/bin/bash', ['-n', '-c', script])).resolves.toBeDefined();
    },
  );

  it('quotes paths so a space or a quote cannot break out of the command', async () => {
    const { buildApplyScript } = await freshModule();
    const script = buildApplyScript(
      1,
      "/tmp/it's here/Luna.app",
      '/Users/someone/My Apps/Luna.app',
      '/tmp/stage',
      false,
    );
    expect(script).toContain(`'/tmp/it'\\''s here/Luna.app'`);
    expect(script).toContain(`'/Users/someone/My Apps/Luna.app'`);
  });
});

describe('applyStagedUpdate', () => {
  it('reports failure when nothing has been staged, so callers can fall back', async () => {
    const { applyStagedUpdate, hasStagedUpdate } = await freshModule();
    expect(hasStagedUpdate()).toBe(false);
    expect(applyStagedUpdate({ relaunch: true })).toBe(false);
  });
});
