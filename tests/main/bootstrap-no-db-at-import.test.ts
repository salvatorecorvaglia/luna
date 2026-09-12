import { describe, expect, it, vi } from 'vitest';

/**
 * Importing a main-process service must not open the database.
 *
 * src/main/index.ts takes the single-instance lock in its module body, at
 * line 27. Its imports — sftp-manager at line 13, ssh-manager at line 14 —
 * are evaluated *before* that body runs. So any database access performed
 * during module evaluation of a service happens before the lock is held, in
 * every process that launches, which is precisely the concurrent-migration
 * race the lock exists to prevent.
 *
 * This was real: both services read tunables at module scope via
 * getRuntimeNumber() -> getSetting() -> getDatabase(), and getDatabase()
 * creates the data directory, opens luna.db and runs every migration. The
 * try/catch in getRuntimeNumber looked like it prevented this ("Database may
 * not be open yet") but could not: getDatabase() does not throw when the
 * database is closed, it opens it.
 *
 * The guard is deliberately blunt — any getDatabase() call during import fails
 * the test, whatever route it arrives by — because the failure mode is a
 * corrupted database on a double launch, and the next module-scope
 * `getSetting()` someone adds should be caught here rather than in the wild.
 */

const getDatabase = vi.fn(() => {
  throw new Error('getDatabase() must not be called while importing a service');
});

vi.mock('../../src/main/services/database', () => ({
  getDatabase,
  // Route getSetting through the same spy: it is the realistic path to
  // getDatabase(), and the whole point is to catch it at one remove.
  getSetting: <T>(_key: string, defaultValue: T): T => {
    getDatabase();
    return defaultValue;
  },
}));

vi.mock('../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('service imports', () => {
  it('does not open the database while importing sftp-manager', async () => {
    await import('../../src/main/services/sftp-manager');
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it('does not open the database while importing ssh-manager', async () => {
    await import('../../src/main/services/ssh-manager');
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it('does not open the database while importing the runtime config', async () => {
    // runtime.ts owns every tunable read. A snapshot taken at its own module
    // scope would reintroduce the bug for all of them at once.
    await import('../../src/main/config/runtime');
    expect(getDatabase).not.toHaveBeenCalled();
  });
});
