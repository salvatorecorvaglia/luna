/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi, describe, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../../renderer/src/App';

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
    onUpdateStatus: vi.fn().mockReturnValue(() => {}),
  },
  connections: {
    list: vi.fn().mockResolvedValue([]),
    onTamper: vi.fn().mockReturnValue(() => {}),
  },
  storage: {
    onTransferProgress: vi.fn().mockReturnValue(() => {}),
    onTransferComplete: vi.fn().mockReturnValue(() => {}),
  },
  shell: {
    onOpenPath: vi.fn().mockReturnValue(() => {}),
    homeDir: vi.fn().mockResolvedValue('/home/user'),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: '' }),
  },
  db: {
    getSetting: vi.fn().mockResolvedValue('""'),
    getAllSettings: vi.fn().mockResolvedValue({}),
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
});

// Mock ResizeObserver which is not present in jsdom but used by xterm/framer-motion
vi.stubGlobal(
  'ResizeObserver',
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
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
  });

  it('renders the welcome view when no connections exist', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Welcome to Lunar/i)).toBeInTheDocument();
  });

  it('opens the connection form when "New Connection" is clicked', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    // Find the button in WelcomeView
    const btn = await screen.findByText(/New Connection/i);
    fireEvent.click(btn);

    // ConnectionForm should now be visible (it has a title "New Connection" in its header)
    // Using getAllByText because "New Connection" is both on the button and the form title
    const titles = await screen.findAllByText(/New Connection/i);
    expect(titles.length).toBeGreaterThan(1);
  });
});
