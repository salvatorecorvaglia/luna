import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const { netRequest, verifyMock } = vi.hoisted(() => ({
  netRequest: vi.fn(),
  verifyMock: vi.fn<(message: Buffer, signature: string) => boolean>(),
}));

vi.mock('electron', () => ({
  get app() {
    return { isPackaged, getPath, on: vi.fn() };
  },
  net: { request: (options: { url: string }) => netRequest(options) },
}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Whether a release-signing key is "compiled in" for the module under test. */
let signingConfigured = true;
vi.mock('../../../src/main/services/update-signature', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/main/services/update-signature')>();
  return {
    ...actual,
    isUpdateSigningConfigured: () => signingConfigured,
    verifyUpdateSignature: (message: Buffer, signature: string) => verifyMock(message, signature),
  };
});

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
  netRequest.mockReset();
  verifyMock.mockReset();
  verifyMock.mockReturnValue(false);
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

  it('is false without a compiled-in update-signing key, however writable the bundle', async () => {
    // Fail closed: with no key there is nothing to prove who built an update,
    // so the in-place path must not run at all.
    signingConfigured = false;
    try {
      const { isSelfInstallSupported } = await freshModule();
      await expect(isSelfInstallSupported()).resolves.toBe(false);
    } finally {
      signingConfigured = true;
    }
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

/**
 * A stand-in for Electron's `net.request`: answers each URL from `routes` with
 * a status and the chunks to stream, one per tick, like a real response.
 */
function serve(routes: Record<string, { status?: number; chunks?: Buffer[] }>): string[] {
  const requested: string[] = [];
  netRequest.mockImplementation(({ url }: { url: string }) => {
    requested.push(url);
    const request = new EventEmitter() as EventEmitter & { end(): void; abort(): void };
    let aborted = false;
    request.abort = () => {
      aborted = true;
    };
    request.end = () => {
      const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1];
      const response = Object.assign(new EventEmitter(), {
        statusCode: route?.status ?? (route ? 200 : 404),
        pause: () => {},
        resume: () => {},
      });
      setImmediate(async () => {
        request.emit('response', response);
        for (const chunk of route?.chunks ?? []) {
          if (aborted) return;
          await new Promise((r) => setImmediate(r));
          response.emit('data', chunk);
        }
        if (!aborted) response.emit('end');
      });
    };
    return request;
  });
  return requested;
}

describe('stageUpdate', () => {
  const payload = Buffer.from('pretend this is a signed Luna.app zip');
  const digest = createHash('sha512').update(payload).digest('base64');
  /** Both arches, so the test does not depend on the machine running it. */
  function feed(overrides: Partial<{ sha512: string; size: number }> = {}) {
    const asset = (arch: string) => ({
      url: `luna-1.6.0-mac-${arch}.zip`,
      sha512: digest,
      size: payload.length,
      ...overrides,
    });
    return { version: '1.6.0', files: [asset('arm64'), asset('x64')] };
  }

  async function stageDirs(): Promise<string[]> {
    return (await readdir(tmpdir())).filter((name) => name.startsWith('luna-update-'));
  }

  it('discards a download whose digest does not match the feed', async () => {
    serve({ '.zip': { chunks: [payload] } });
    const { stageUpdate } = await freshModule();
    const before = await stageDirs();
    await expect(stageUpdate(feed({ sha512: 'not-the-digest' }), vi.fn())).rejects.toThrow(
      /failed its checksum/,
    );
    // The partial download is deleted, not left in the temp directory.
    expect(await stageDirs()).toEqual(before);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('stops a download that runs past the size the feed declared', async () => {
    serve({ '.zip': { chunks: [payload, Buffer.from('trailing bytes')] } });
    const { stageUpdate } = await freshModule();
    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/larger than the feed declared/);
  });

  it('rejects a download that ends short of the declared size', async () => {
    serve({ '.zip': { chunks: [payload.subarray(0, 5)] } });
    const { stageUpdate } = await freshModule();
    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/ended early/);
  });

  it('surfaces an HTTP error from the asset host', async () => {
    serve({ '.zip': { status: 404 } });
    const { stageUpdate } = await freshModule();
    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/HTTP 404/);
  });

  it('refuses an update with no published signature', async () => {
    serve({ '.zip': { chunks: [payload] } });
    const { stageUpdate } = await freshModule();
    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/not signed/);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized signature file without buffering it', async () => {
    serve({ '.zip': { chunks: [payload] }, '.sig': { chunks: [Buffer.alloc(4096, 65)] } });
    const { stageUpdate } = await freshModule();
    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/signature is malformed/);
  });

  it('verifies the signature over version, file name and digest before unpacking', async () => {
    serve({ '.zip': { chunks: [payload] }, '.sig': { chunks: [Buffer.from('c2ln\n')] } });
    const { stageUpdate } = await freshModule();
    const { updateSignatureMessage } = await import('../../../src/main/services/update-signature');
    const before = await stageDirs();

    await expect(stageUpdate(feed(), vi.fn())).rejects.toThrow(/signature is invalid/);

    const asset = process.arch === 'arm64' ? 'luna-1.6.0-mac-arm64.zip' : 'luna-1.6.0-mac-x64.zip';
    expect(verifyMock).toHaveBeenCalledWith(
      updateSignatureMessage('1.6.0', asset, digest),
      'c2ln\n',
    );
    expect(await stageDirs()).toEqual(before);
  });

  it('only ever requests URLs on the release host, however the feed names the file', async () => {
    const requested = serve({});
    const { stageUpdate } = await freshModule();
    const hostile = {
      version: '1.6.0',
      files: ['arm64', 'x64'].map((arch) => ({
        url: `https://evil.example/../x?-mac-${arch}.zip`,
        sha512: digest,
        size: payload.length,
      })),
    };
    await expect(stageUpdate(hostile, vi.fn())).rejects.toThrow();
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(new URL(url).origin).toBe('https://github.com');
      expect(url).not.toContain('evil.example/');
    }
  });
});
