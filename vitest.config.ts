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
      // Locks in the current floor (at least 5%) so a regression fails CI; raise these
      // as new tests are added rather than treating them as project goals.
      thresholds: {
        lines: 5,
        functions: 5,
        branches: 5,
        statements: 5
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
