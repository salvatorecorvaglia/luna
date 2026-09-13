import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * runtime.ts is the single read path for every main-process tunable, and it had
 * no test at all — despite being the module that clamps a hand-edited settings
 * row so it cannot pin a timer at 0ms or hand the S3 client a 1-byte partSize.
 *
 * It is also load-bearing for bootstrap: the lazy tunable groups here are what
 * keep importing a service from opening the database before the single-instance
 * lock is taken (see bootstrap-no-db-at-import.test.ts).
 */

const getSetting = vi.fn();

vi.mock('../../../src/main/services/database', () => ({
  getSetting: (key: string, def: unknown) => getSetting(key, def),
  getDatabase: vi.fn(),
}));

async function freshRuntime(): Promise<typeof import('../../../src/main/config/runtime')> {
  vi.resetModules();
  return import('../../../src/main/config/runtime');
}

beforeEach(() => {
  getSetting.mockReset();
  // Default: no stored override, so the compile-time default comes back.
  getSetting.mockImplementation((_key: string, def: unknown) => def);
});

describe('SETTING_KEYS / RUNTIME_BOUNDS contract', () => {
  it('gives every tunable a settings key', async () => {
    const { DEFAULTS, SETTING_KEYS } = await freshRuntime();
    for (const name of Object.keys(DEFAULTS)) {
      expect(
        SETTING_KEYS[name as keyof typeof DEFAULTS],
        `${name} has no settings key`,
      ).toBeTruthy();
    }
  });

  it('gives every tunable a bounds entry, keyed by its settings key', async () => {
    // The read path clamps against RUNTIME_BOUNDS and the IPC write path rejects
    // against the same table, so a tunable missing from it is silently unclamped.
    const { DEFAULTS, SETTING_KEYS, RUNTIME_BOUNDS } = await freshRuntime();
    for (const name of Object.keys(DEFAULTS)) {
      const key = SETTING_KEYS[name as keyof typeof DEFAULTS];
      expect(RUNTIME_BOUNDS[key], `${key} has no bounds`).toBeDefined();
    }
  });

  it('places every default inside its own bounds', async () => {
    const { DEFAULTS, SETTING_KEYS, RUNTIME_BOUNDS } = await freshRuntime();
    for (const [name, value] of Object.entries(DEFAULTS)) {
      const bounds = RUNTIME_BOUNDS[SETTING_KEYS[name as keyof typeof DEFAULTS]];
      expect(bounds).toBeDefined();
      expect(value, `${name} default below min`).toBeGreaterThanOrEqual(bounds!.min);
      expect(value, `${name} default above max`).toBeLessThanOrEqual(bounds!.max);
    }
  });
});

describe('getRuntimeNumber', () => {
  it('returns a stored value that is inside bounds', async () => {
    getSetting.mockImplementation((key: string, def: unknown) =>
      key === 'sftp.transferConcurrency' ? 128 : def,
    );
    const { getRuntimeNumber } = await freshRuntime();
    expect(getRuntimeNumber('SFTP_TRANSFER_CONCURRENCY')).toBe(128);
  });

  it.each([
    ['below min', 0],
    ['above max', 100_000],
  ])('falls back to the default for a value %s', async (_label, stored) => {
    getSetting.mockImplementation((key: string, def: unknown) =>
      key === 'sftp.transferConcurrency' ? stored : def,
    );
    const { getRuntimeNumber, DEFAULTS } = await freshRuntime();
    expect(getRuntimeNumber('SFTP_TRANSFER_CONCURRENCY')).toBe(DEFAULTS.SFTP_TRANSFER_CONCURRENCY);
  });

  it.each([
    ['a string', '64'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['negative', -1],
  ])('falls back to the default for %s', async (_label, stored) => {
    getSetting.mockImplementation((key: string, def: unknown) =>
      key === 'sftp.idleTimeoutMs' ? stored : def,
    );
    const { getRuntimeNumber, DEFAULTS } = await freshRuntime();
    expect(getRuntimeNumber('SFTP_IDLE_TIMEOUT_MS')).toBe(DEFAULTS.SFTP_IDLE_TIMEOUT_MS);
  });

  it('falls back to the default when the database throws', async () => {
    getSetting.mockImplementation(() => {
      throw new Error('database is locked');
    });
    const { getRuntimeNumber, DEFAULTS } = await freshRuntime();
    expect(getRuntimeNumber('S3_UPLOAD_QUEUE_SIZE')).toBe(DEFAULTS.S3_UPLOAD_QUEUE_SIZE);
  });
});

describe('lazy tunable groups', () => {
  it('reads nothing until first use', async () => {
    // The property that keeps service imports from opening the database.
    const { getSshReconnectTunables } = await freshRuntime();
    expect(getSetting).not.toHaveBeenCalled();

    getSshReconnectTunables();
    expect(getSetting).toHaveBeenCalled();
  });

  it('snapshots each group once', async () => {
    const { getTransferTunables } = await freshRuntime();
    getTransferTunables();
    const afterFirst = getSetting.mock.calls.length;
    getTransferTunables();
    expect(getSetting.mock.calls.length).toBe(afterFirst);
  });

  it('re-reads every group after invalidateRuntimeCache', async () => {
    // settings:set calls this, and all three groups must honour it — a group
    // that ignores it leaves its settings permanently frozen, which is the bug
    // the module-scope constants used to have.
    const runtime = await freshRuntime();
    runtime.getTransferTunables();
    runtime.getSshReconnectTunables();
    runtime.getSftpIdleTunables();
    const before = getSetting.mock.calls.length;

    runtime.invalidateRuntimeCache();
    runtime.getTransferTunables();
    runtime.getSshReconnectTunables();
    runtime.getSftpIdleTunables();

    expect(getSetting.mock.calls.length).toBeGreaterThan(before);
  });

  it('picks up a changed setting after invalidation', async () => {
    let stored = 1_000;
    getSetting.mockImplementation((key: string, def: unknown) =>
      key === 'ssh.reconnectBaseDelayMs' ? stored : def,
    );
    const { getSshReconnectTunables, invalidateRuntimeCache } = await freshRuntime();

    expect(getSshReconnectTunables().baseDelayMs).toBe(1_000);
    stored = 5_000;
    // Still cached until invalidated.
    expect(getSshReconnectTunables().baseDelayMs).toBe(1_000);

    invalidateRuntimeCache();
    expect(getSshReconnectTunables().baseDelayMs).toBe(5_000);
  });
});
