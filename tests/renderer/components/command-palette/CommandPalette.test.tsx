// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../../../../src/renderer/src/components/command-palette/CommandPalette';
import { useConnectionStore } from '../../../../src/renderer/src/stores/connection-store';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';
import { installFakeApi } from '../../../../src/test/fake-api';

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

describe('CommandPalette — ARIA combobox', () => {
  it('exposes combobox/listbox roles wired together, with aria-activedescendant tracking the selected option', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'settings' } });
    const option = await screen.findByRole('option', { name: /open settings/i });

    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'command-palette-listbox');
    expect(screen.getByRole('listbox')).toHaveAttribute('id', 'command-palette-listbox');
    expect(option).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
  });

  it('moves aria-activedescendant as ArrowDown changes the selection', async () => {
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'view' } });
    const options = await screen.findAllByRole('option');
    expect(options.length).toBeGreaterThan(1);

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
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

describe('CommandPalette — selection ordering', () => {
  /**
   * Regression: the highlighted row and the executed command were resolved
   * against two different arrays. Rows were indexed by their *grouped*
   * position, while Enter and aria-activedescendant read the flat
   * `[...staticCommands, ...connectionCommands]` list. With any saved
   * connection the two disagree, so the palette highlighted one command and
   * ran another. This asserts they are the same command.
   */
  function highlightedLabel(): string {
    const selected = document.querySelector('[data-selected="true"]');
    expect(selected).not.toBeNull();
    return selected?.textContent ?? '';
  }

  it('runs the command the user can see highlighted', async () => {
    useConnectionStore.setState({ connectionFormOpen: false, editingConnectionId: null });
    (api.connections.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', name: 'prod-db', host: 'db.example.com', port: 22, username: 'root' },
    ]);

    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    // Wait for the connection-derived commands to land, so the grouped and
    // flat orderings actually diverge.
    await screen.findByText(/prod-db/);

    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });

    const shown = highlightedLabel();
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();

    // aria-activedescendant must point at the row that is visually highlighted.
    const active = document.getElementById(activeId as string);
    expect(active?.getAttribute('data-selected')).toBe('true');
    expect(active?.textContent).toBe(shown);
  });

  it('keeps aria-activedescendant on the highlighted row at every step', async () => {
    (api.connections.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', name: 'alpha', host: 'a.example.com', port: 22, username: 'root' },
      { id: 'c2', name: 'beta', host: 'b.example.com', port: 22, username: 'root' },
    ]);

    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    await screen.findByText(/alpha/);

    for (let i = 0; i < 8; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const activeId = input.getAttribute('aria-activedescendant');
      const active = activeId ? document.getElementById(activeId) : null;
      expect(active, `step ${i}: aria-activedescendant resolves to a rendered row`).not.toBeNull();
      expect(active?.getAttribute('data-selected'), `step ${i}: it is the highlighted row`).toBe(
        'true',
      );
    }
  });

  it('keeps the palette mounted for a command that opens a nested dialog', async () => {
    // "Delete All Connections" only sets local state to open a ConfirmDialog.
    // Closing the palette unmounted the component — and the dialog with it — so
    // the command was a silent no-op.
    renderPalette();
    const input = await screen.findByPlaceholderText('Type a command...');
    fireEvent.change(input, { target: { value: 'Delete All' } });

    const row = await screen.findByText('Delete All Connections');
    fireEvent.click(row);

    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
    expect(await screen.findByText('Delete all connections?')).toBeTruthy();
  });
});
