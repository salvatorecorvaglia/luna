import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above module-scope consts, so the spy has to
// be created inside vi.hoisted to exist by the time the factory runs.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

// promisify(execFile) reads the custom-promisified symbol when present, so the
// mock exposes it directly rather than relying on callback conventions.
vi.mock('node:child_process', () => ({
  execFile: Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileMock,
  }),
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PasswordManagerService } from '../../../src/main/services/password-manager-service';

const service = new PasswordManagerService();

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockResolvedValue({ stdout: 'hunter2\n', stderr: '' });
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
    const [, args] = execFileMock.mock.calls[0];
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
    const [, , options] = execFileMock.mock.calls[0];
    expect(options.maxBuffer).toBeGreaterThan(0);
    expect(options.timeout).toBeGreaterThan(0);
  });
});
