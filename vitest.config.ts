import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // Playwright owns tests/e2e/; vitest has no Electron to launch and would fail
    // on the first import of @playwright/test's electron helper.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Default to node; renderer .tsx tests opt into jsdom via
    // `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: [
        'src/main/**/*.{ts,tsx}',
        // The preload is the entire renderer↔main attack surface (326 lines of
        // bridge). It was excluded from measurement entirely, which both
        // flattered the reported numbers and hid regressions in invoke() and
        // createEventListener().
        'src/preload/**/*.ts',
        'src/renderer/src/**/*.{ts,tsx}',
        'src/shared/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/env.d.ts',
        'src/test/**',
        'src/renderer/src/themes/terminal/**',
      ],
      // Floor, not a target — a ratchet that stops coverage regressing.
      //
      // Raise these whenever a run reports higher. The policy matters: a stale
      // floor reads as enforcement while enforcing nothing, which is how this
      // gate once sat ~14 points under reality.
      //
      // What the floor covers: IPC input validation (including the symlink jail
      // and its O_NOFOLLOW anchoring), host-key TOFU with the changed-key MITM
      // and weak-algorithm cases, OpenSSH-format fingerprints, credential
      // AES-GCM round-trip, tamper detection, and the connection_id AAD binding
      // that stops a blob being moved between rows, the locked-keyring path that
      // must never regenerate the master key, file:// navigation allowlisting,
      // SOCKS5 request parsing under fragmentation, port-forward config
      // validation and the public-bind gate, password-manager reference grammar
      // and argument-injection refusal, sliding-window rate limiting, the
      // transfer queue including download-destination exclusivity, emit
      // redaction plus the RAW_CHANNELS allowlist, the IPC error shape (no stack
      // or metadata across the bridge), local-terminal output batching and the
      // session cap, connection create/update/import validation parity, db
      // migrations, error-map classification, terminal output sanitisation, the
      // command palette's selection ordering, the terminal key handler's "never
      // swallow a plain Ctrl+C — or Ctrl+K" invariant, the SSH reconnect ladder
      // end to end, the guard that importing a service must not open the
      // database, the preload bridge's error translation and listener teardown,
      // the runtime tunable clamps, the stacked focus-trap stack, and the guard
      // asserting every focus-trapping dialog declares a modal role.
      //
      // src/preload is in the coverage `include` above. It sat at 0% for a long
      // time because being included is not the same as being tested — nothing
      // imported it until tests/main/preload.test.ts.
      //
      // These cover the vitest suite only. The Playwright suite under
      // tests/e2e/ is excluded above and is not measured here — it exists to
      // prove main/preload/renderer agree at runtime, which is not a
      // line-coverage question.
      //
      // Measured 2026-09-13 over three consecutive runs with zero variance:
      // 62.32 statements / 55.28 branches / 55.94 functions / 63.69 lines.
      // Floors sit ~1pt under that.
      thresholds: {
        lines: 62,
        functions: 54,
        branches: 54,
        statements: 61,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
