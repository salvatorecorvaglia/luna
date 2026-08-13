// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../../../src/test/fake-api';
import { useConnectionStore } from '../../../../src/renderer/src/stores/connection-store';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';
import { CommandPalette } from '../../../../src/renderer/src/components/command-palette/CommandPalette';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let api: ReturnType<typeof installFakeApi>;

function renderPalette(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommandPalette />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api = installFakeApi();
  useUIStore.setState({ commandPaletteOpen: true, activeView: 'terminal' });
  useConnectionStore.setState({ connectionFormOpen: false, editingConnectionId: null });
  useTerminalStore.setState({
    sessions: new Map(),
    tabOrder: [],
    activeSessionId: null,
    layouts: new Map(),
  });
});

describe('CommandPalette — visibility', () => {
  it('renders nothing while closed', () => {
    useUIStore.setState({ commandPaletteOpen: false });
    renderPalette();
    expect(screen.queryByPlaceholderText('Type a command...')).toBeNull();
  });

  it('focuses the search box when opened', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('closes on Escape', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(useUIStore.getState().commandPaletteOpen).toBe(false));
  });
});

describe('CommandPalette — filtering', () => {
  it('narrows the list as the user types', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');

    fireEvent.change(input, { target: { value: 'settings' } });

    await waitFor(() => expect(screen.getByText(/settings/i)).toBeTruthy());
    // A term that matches nothing should not leave unrelated commands showing.
    fireEvent.change(input, { target: { value: 'zzzznotacommand' } });
    await waitFor(() => expect(screen.queryByText(/open settings/i)).toBeNull());
  });

  it('lists saved connections as connect commands', async () => {
    (api.connections.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c1',
        name: 'prod-web',
        provider: 'sftp',
        host: 'example.com',
        port: 22,
        username: 'deploy',
        authType: 'password',
        folder: 'default',
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    renderPalette();

    await waitFor(() => expect(screen.getByText(/prod-web/)).toBeTruthy());
  });
});

describe('CommandPalette — actions', () => {
  it('opens the connection form and closes itself', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'new connection' } });

    const item = await screen.findByText(/new connection/i);
    fireEvent.click(item);

    await waitFor(() => {
      expect(useConnectionStore.getState().connectionFormOpen).toBe(true);
      expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  it('switches the active view', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'switch to sftp' } });

    fireEvent.click(await screen.findByText('Switch to SFTP'));

    await waitFor(() => expect(useUIStore.getState().activeView).toBe('sftp'));
  });

  it('does not delete all connections without a confirmation step', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'delete all' } });

    const item = await screen.findByText(/delete all/i);
    fireEvent.click(item);

    // Selecting the command must open a confirm, never fire the destructive
    // call straight from a fuzzy search match.
    expect(api.connections.deleteAll).not.toHaveBeenCalled();
  });
});
