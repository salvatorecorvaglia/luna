import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above module-scope consts, so the spies have to
// be created inside vi.hoisted to exist by the time the factories run.
const { execFileMock, accessMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  accessMock: vi.fn(),
}));

// promisify(execFile) reads the custom-promisified symbol when present, so the
// mock exposes it directly rather than relying on callback conventions.
vi.mock('node:child_process', () => ({
  execFile: Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileMock,
  }),
}));

// Only consulted on the win32 branch, where the service probes PATH for a real
// executable instead of handing a bare name to execFile.
vi.mock('node:fs/promises', () => ({ access: accessMock }));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PasswordManagerService } from '../../../src/main/services/password-manager-service';

const service = new PasswordManagerService();

const REAL_PLATFORM = process.platform;
const REAL_PATH = process.env['PATH'];

/**
 * The reference grammar and the argv shape are platform-independent, but the
 * lookup in front of them is not: on win32 the service resolves the binary
 * through PATH itself (execFile without a shell will not append `.exe`), so on
 * a Windows runner every one of these cases died with "CLI not found" before
 * the code under test ran. Pin the platform per test instead.
 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  setPlatform('linux');
  execFileMock.mockReset();
  execFileMock.mockResolvedValue({ stdout: 'hunter2\n', stderr: '' });
  accessMock.mockReset();
});

afterAll(() => {
  setPlatform(REAL_PLATFORM);
  if (REAL_PATH === undefined) delete process.env['PATH'];
  else process.env['PATH'] = REAL_PATH;
});

describe('resolveSecretReference — accepted references', () => {
  it('reads a 1Password reference', async () => {
    await expect(service.resolveSecretReference('op://Private/db/password')).resolves.toBe(
      'hunter2',
    );
    expect(execFileMock).toHaveBeenCalledWith(
      'op',
      ['read', '--', 'op://Private/db/password'],
      expect.anything(),
    );
  });

  it('supports the optional section segment', async () => {
    await expect(service.resolveSecretReference('op://Private/db/section/password')).resolves.toBe(
      'hunter2',
    );
  });

  it('reads a Bitwarden reference', async () => {
    await expect(service.resolveSecretReference('bw://my-server')).resolves.toBe('hunter2');
    expect(execFileMock).toHaveBeenCalledWith(
      'bw',
      ['get', 'password', '--', 'my-server'],
      expect.anything(),
    );
  });

  it('returns null when the CLI produces no output', async () => {
    execFileMock.mockResolvedValue({ stdout: '  \n', stderr: '' });
    await expect(service.resolveSecretReference('bw://empty')).resolves.toBeNull();
  });
});

describe('resolveSecretReference — argument injection', () => {
  // execFile blocks *shell* injection, but not argument injection: the previous
  // implementation passed everything after bw:// straight through as argv, so a
  // reference starting with '-' became a flag to the bw binary.
  it.each([
    'bw://--help',
    'bw://-c',
    'bw://--config=/tmp/evil',
    'bw://item; rm -rf /',
    'bw://item$(whoami)',
    'bw://item`id`',
    'bw://item|cat',
    'bw://../../etc/passwd',
    'bw://item\nsecond-line',
  ])('refuses the hostile Bitwarden reference %j', async (ref) => {
    await expect(service.resolveSecretReference(ref)).rejects.toThrow(/Invalid Bitwarden/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it.each([
    'op://--vault/item/field',
    'op://vault/item',
    'op://vault/item/field/extra/toomany',
    'op://vault/item/field;whoami',
    'op:///item/field',
  ])('refuses the malformed 1Password reference %j', async (ref) => {
    await expect(service.resolveSecretReference(ref)).rejects.toThrow(/Invalid 1Password/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('always passes -- before the user-controlled argument', async () => {
    await service.resolveSecretReference('bw://legit-item');
    const [, args] = execFileMock.mock.calls[0]!;
    expect(args[args.length - 2]).toBe('--');
  });
});

describe('resolveSecretReference — other rejections', () => {
  it.each([
    ['an unsupported scheme', 'vault://secret'],
    ['a bare string', 'just-a-password'],
    ['a file path', '/etc/passwd'],
  ])('rejects %s', async (_label, ref) => {
    await expect(service.resolveSecretReference(ref)).rejects.toThrow(/Unsupported secret/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it.each([
    ['', null],
    ['   ', null],
  ])('returns null for empty input %j', async (ref) => {
    await expect(service.resolveSecretReference(ref as string)).resolves.toBeNull();
  });

  it('rejects an over-long reference before touching the CLI', async () => {
    const huge = `bw://${'a'.repeat(600)}`;
    await expect(service.resolveSecretReference(huge)).rejects.toThrow(/exceeds/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('surfaces a clear error when the CLI is not installed', async () => {
    execFileMock.mockRejectedValue(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    await expect(service.resolveSecretReference('bw://item')).rejects.toThrow(/not found on PATH/);
  });

  it('returns null (not the stderr) when the CLI exits non-zero', async () => {
    // stderr from these tools echoes the item path being read, so it must not
    // propagate to the renderer.
    execFileMock.mockRejectedValue(
      Object.assign(new Error('exit 1'), { code: 1, stderr: 'error reading op://Private/secret' }),
    );
    await expect(service.resolveSecretReference('bw://item')).resolves.toBeNull();
  });

  it('bounds CLI output so a wedged binary cannot stream unbounded data', async () => {
    await service.resolveSecretReference('bw://item');
    const [, , options] = execFileMock.mock.calls[0]!;
    expect(options.maxBuffer).toBeGreaterThan(0);
    expect(options.timeout).toBeGreaterThan(0);
  });
});

describe('resolveSecretReference — Windows executable resolution', () => {
  // node:path binds `delimiter` (and `join`) to the *real* platform at import
  // time, not the pinned one, so a single colon-free PATH entry keeps this
  // readable on a POSIX runner — a `C:` drive letter would be split apart by
  // the POSIX PATH delimiter.
  const PATH_DIR = '\\tools\\bin';

  beforeEach(() => {
    setPlatform('win32');
    process.env['PATH'] = PATH_DIR;
  });

  it('appends .exe and runs the resolved absolute path', async () => {
    accessMock.mockImplementation(async (candidate: string) => {
      if (!candidate.endsWith('op.exe'))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    await expect(service.resolveSecretReference('op://Private/db/password')).resolves.toBe(
      'hunter2',
    );
    expect(execFileMock).toHaveBeenCalledWith(
      join(PATH_DIR, 'op.exe'),
      ['read', '--', 'op://Private/db/password'],
      expect.anything(),
    );
  });

  it('refuses a .cmd shim rather than routing credentials through a command processor', async () => {
    accessMock.mockImplementation(async (candidate: string) => {
      if (!candidate.endsWith('bw.cmd'))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    await expect(service.resolveSecretReference('bw://item')).rejects.toThrow(/not found on PATH/);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
