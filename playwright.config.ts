import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the packaged Electron main process.
 *
 * These cover the one thing the vitest suite structurally cannot: that main,
 * preload and renderer actually agree at runtime. Everything below the
 * contextBridge is mocked in unit tests, so a channel renamed on one side of
 * `shared/types/ipc.ts` and not the other still passes 684 tests — the types
 * line up because both sides import the same map, but nothing proves a handler
 * is registered for every channel the preload exposes.
 *
 * Deliberately kept small. E2E here is a contract check and a smoke test, not
 * a place to re-test business logic that has cheaper coverage elsewhere.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Electron tests share one userData directory per run; running them in
  // parallel would have them fighting over the same SQLite file.
  workers: 1,
  fullyParallel: false,
  // A hung Electron launch should fail the job, not sit until the CI timeout.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
