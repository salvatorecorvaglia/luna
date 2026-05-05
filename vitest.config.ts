import {defineConfig} from 'vitest/config'
import {resolve} from 'path'

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
      // Floor — tests cover validation, host-key TOFU, transfer-queue, credential
      // round-trip, and parts of ssh-manager. Raise as new tests are added rather
      // than treating these as final goals.
      thresholds: {
        lines: 10,
        functions: 8,
        branches: 7,
        statements: 10
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
