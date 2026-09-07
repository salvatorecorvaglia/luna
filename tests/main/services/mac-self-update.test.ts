import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

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
    // /Applications/Luna.app does not exist in CI, so the W_OK probe fails —
    // which is the same signal as an admin-installed app the user cannot touch.
    const { isSelfInstallSupported } = await freshModule();
    await expect(isSelfInstallSupported()).resolves.toBe(false);
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

  it('is valid bash — a syntax slip here would fail silently after the app quits', async () => {
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
  });

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
