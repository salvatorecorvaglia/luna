import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve('@playwright/test/cli'), 'test', 'tests/e2e/performance.spec.ts'],
  {
    env: { ...process.env, LUNA_PROFILE: '1' },
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
