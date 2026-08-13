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
      include: ['src/main/**/*.{ts,tsx}', 'src/renderer/src/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/env.d.ts',
        'src/test/**',
        'src/renderer/src/themes/terminal/**'
      ],
      // Floor — covers validation (incl. symlink jail), host-key TOFU +
      // IPv6 disambiguation + OpenSSH fingerprint format, SOCKS5 request
      // parsing (fragmentation and malformed input), port-forward config
      // validation and the public-bind gate, password-manager reference
      // grammar and argument-injection refusal, sliding-window rate limiting,
      // transfer-queue, credential round-trip, emit redaction plus the
      // RAW_CHANNELS allowlist, IPC error shape (no stack/metadata across the
      // bridge), local-terminal output batching and the session cap,
      // connection create/update validation parity, db migrations, error-map
      // classification, terminal-output sanitisation, the host-key dialog's
      // reject path, the port-forward runtime against real sockets (bind
      // failure, teardown of live connections, fragmented SOCKS handshakes),
      // and the shared abortable-stream skeleton's abort/completion races.
      //
      // Added in the 2026-08 audit pass: the storage-provider re-registration
      // that keeps SFTP alive across an automatic SSH reconnect, folder-sync
      // mtime comparison (the tolerance is in seconds — see the service),
      // local-terminal buffer draining on exit/kill, connection *import*
      // validation parity with create, snippet/workspace malformed-column
      // resilience and IPC input bounds, C1-control terminal sanitisation,
      // the updater's awaited check, and a guard asserting every
      // focus-trapping dialog declares its modal role.
      //
      // A ratchet, not a target: raise these whenever a run reports higher so
      // coverage can't silently regress. Actuals at the time of writing move
      // between ~48.6-48.7 lines, 40.0-40.5 branches, 41.3-41.8 functions and
      // 47.4-47.6 statements — the spread is real run-to-run variance, so the
      // floors sit ~1pt below the *lower* end rather than just under the best
      // observed value. A floor pinned to the peak flakes in CI.
      //
      // Note these cover the vitest suite only. The Playwright suite under
      // e2e/ is excluded above and is not measured here — it exists to prove
      // main/preload/renderer agree at runtime, which is not a line-coverage
      // question.
      thresholds: {
        lines: 47,
        functions: 40,
        branches: 39,
        statements: 46
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
