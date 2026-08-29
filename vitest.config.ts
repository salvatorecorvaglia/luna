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
      // Raise these whenever a run reports higher. They were last left at
      // lines 47 / functions 40 / branches 39 / statements 46, with a comment
      // documenting actuals of "~48.6-48.7 lines". By the 2026-08-29 audit the
      // real numbers had reached ~62 lines, so the gate sat ~14 points below
      // reality and coverage could have regressed by a fifth before CI noticed.
      // A stale ratchet is worse than none: it reads as enforcement while
      // enforcing nothing.
      //
      // What the floor covers: IPC input validation (including the symlink
      // jail and its O_NOFOLLOW anchoring), host-key TOFU with the changed-key
      // MITM and weak-algorithm cases, OpenSSH-format fingerprints, credential
      // AES-GCM round-trip and tamper detection, the locked-keyring path that
      // must never regenerate the master key, file:// navigation allowlisting,
      // SOCKS5 request parsing under fragmentation, port-forward config
      // validation and the public-bind gate, password-manager reference grammar
      // and argument-injection refusal, sliding-window rate limiting, the
      // transfer queue, emit redaction plus the RAW_CHANNELS allowlist, the IPC
      // error shape (no stack or metadata across the bridge), local-terminal
      // output batching and the session cap, connection create/update/import
      // validation parity, db migrations, error-map classification, terminal
      // output sanitisation, the command palette's selection ordering, the
      // terminal key handler's "never swallow a plain Ctrl+C" invariant, and
      // the guard asserting every focus-trapping dialog declares a modal role.
      //
      // src/preload is in the coverage `include` above as of this pass. It is
      // the entire renderer<->main bridge and was previously unmeasured, which
      // flattered these numbers.
      //
      // Measured 2026-08-29 over three consecutive runs with zero variance:
      // 61.05 statements / 53.34 branches / 53.56 functions / 62.45 lines.
      // Floors sit ~1pt under that.
      //
      // These cover the vitest suite only. The Playwright suite under
      // tests/e2e/ is excluded above and is not measured here — it exists to
      // prove main/preload/renderer agree at runtime, which is not a
      // line-coverage question.
      thresholds: {
        lines: 61,
        functions: 52,
        branches: 52,
        statements: 60,
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
