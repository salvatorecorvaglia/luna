import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { __setApiForTesting } from '../renderer/src/services/api';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/luna-test-${name}`,
    isPackaged: false,
    getVersion: () => '1.1.0',
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

// jsdom implements neither of these, and both are called from ordinary
// component effects (scroll-into-view on keyboard navigation, ResizeObserver
// in the terminal panes). Without the stubs a component under test throws
// from an effect, which surfaces as an unrelated-looking failure.
if (typeof globalThis.Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no-op: layout does not exist in jsdom */
  };
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Clear any fake API installed by `installFakeApi()`. Registered once here
// rather than inside installFakeApi itself: that helper is called from a
// test's `beforeEach`, and registering an `afterEach` while hooks are already
// running is unsupported — it either never fires or stacks one extra hook per
// test.
afterEach(() => {
  __setApiForTesting(null);
});
