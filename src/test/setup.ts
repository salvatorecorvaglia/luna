import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/luna-test-${name}`,
    isPackaged: false,
    getVersion: () => '1.0.0',
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}));

vi.mock('electron-log/main', () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: { level: 'info', getFile: () => ({ path: '/tmp/luna.log' }) },
      console: { level: false },
    },
    hooks: {
      push: vi.fn(),
    },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
