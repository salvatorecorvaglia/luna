import {defineConfig, externalizeDepsPlugin} from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: process.env.NODE_ENV !== 'production'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: process.env.NODE_ENV !== 'production'
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      sourcemap: process.env.NODE_ENV !== 'production',
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          // Bucket heavy renderer-only vendors into stable chunks so the main
          // app chunk stays small and chunk hashes don't churn when app code
          // changes but deps don't. Lazy routes (SFTP / Terminal / Settings)
          // pick these up automatically via dynamic import.
          manualChunks(id: string): string | undefined {
            if (id.includes('@xterm')) return 'xterm';
            if (id.includes('@tanstack/react-query')) return 'react-query';
            if (id.includes('@tanstack/react-virtual')) return 'react-virtual';
            if (id.includes('framer-motion')) return 'framer-motion';
            return undefined;
          }
        }
      }
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
