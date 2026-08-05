/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../../renderer/src/App';
import { useTerminalStore } from '../../renderer/src/stores/terminal-store';
import { useUIStore } from '../../renderer/src/stores/ui-store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// Mock electron global (api is added to window via preload in real app)
vi.stubGlobal('api', {
  app: {
    getCredentialBackend: vi.fn().mockResolvedValue({ backend: 'safeStorage' }),
    getVersion: vi.fn().mockResolvedValue('1.2.3'),
    getActiveSessions: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
    onUpdateAvailable: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloadProgress: vi.fn().mockReturnValue(() => {}),
    onUpdateDownloaded: vi.fn().mockReturnValue(() => {}),
    onUpdateError: vi.fn().mockReturnValue(() => {}),
    installUpdate: vi.fn().mockResolvedValue(undefined),
  },
  connections: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reorder: vi.fn().mockResolvedValue(undefined),
  },
  credentials: {
    onTamper: vi.fn().mockReturnValue(() => {}),
  },
  ssh: {
    onHostKeyChange: vi.fn().mockReturnValue(() => {}),
    trustHostKey: vi.fn().mockResolvedValue({ trusted: true }),
  },
  transfers: {
    onProgress: vi.fn().mockReturnValue(() => {}),
    onComplete: vi.fn().mockReturnValue(() => {}),
    onError: vi.fn().mockReturnValue(() => {}),
    onCancelled: vi.fn().mockReturnValue(() => {}),
  },
  storage: {
    list: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    readFile: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    onListTruncated: vi.fn().mockReturnValue(() => {}),
  },
  shell: {
    homeDir: vi.fn().mockResolvedValue('/home/user'),
    readdir: vi.fn().mockResolvedValue([]),
    openFileDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    saveFileDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: '' }),
  },
  settings: {
    get: vi.fn().mockResolvedValue('""'),
    set: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue({}),
  },
  window: {
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximize: vi.fn().mockReturnValue(() => {}),
    onUnmaximize: vi.fn().mockReturnValue(() => {}),
    onFocus: vi.fn().mockReturnValue(() => {}),
    onBlur: vi.fn().mockReturnValue(() => {}),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
  },
  terminal: {
    spawn: vi.fn().mockResolvedValue('t1'),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {}),
  },
  localTerminal: {
    spawn: vi.fn().mockResolvedValue('lt1'),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {}),
  },
  s3: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
  },
  log: vi.fn().mockResolvedValue(undefined),
});

// Mock ResizeObserver which is not present in jsdom but used by xterm/framer-motion
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

// Mock matchMedia
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

describe('Connections Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    useUIStore.setState({ activeView: 'terminal', sidebarOpen: true });
    useTerminalStore.setState({ tabOrder: [], sessions: new Map() });
  });

  it('renders the welcome view when no connections exist', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Welcome to Luna/i)).toBeInTheDocument();
  });

  it('opens the connection form when "New Connection" is clicked', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    // Ensure app is loaded
    await screen.findByText(/Connections/i);

    // Use the sidebar plus button (aria-label="New connection")
    const btn = await screen.findByLabelText(/New connection/i);
    fireEvent.click(btn);

    // ConnectionForm should now be visible (it has a title "New Connection" in its header)
    const titles = await screen.findAllByText(/New Connection/i);
    expect(titles.length).toBeGreaterThan(0);
  });
});
