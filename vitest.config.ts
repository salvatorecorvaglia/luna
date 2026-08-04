import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
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
      // Floor — covers validation (incl. symlink jail), host-key TOFU and
      // IPv6 disambiguation, transfer-queue, credential round-trip + IPC
      // byte-length cap + ring-buffer rate limiter, emit redaction, ssh.ipc
      // validation, db.ipc import sanitization, db migrations, error-map
      // classification, and terminal-output sanitisation. Raise as new
      // tests are added rather than treating these as final goals.
      thresholds: {
        lines: 34,
        functions: 28,
        branches: 25,
        statements: 33
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
