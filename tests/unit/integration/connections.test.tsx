/**
 * @vitest-environment jsdom
 *
 * App-level integration: the sidebar, the welcome view, and the connection
 * form, wired through the real stores and the real getApi() seam.
 *
 * Rewritten from a version that hand-rolled a 130-line `vi.stubGlobal('api', …)`
 * — duplicating `src/test/fake-api.ts`, bypassing the `getApi()` seam the
 * design-token guard exists to enforce, and stubbing a `terminal:` namespace
 * that no longer exists on `LunaAPI`. Its two assertions were also weak enough
 * to pass without the behaviour under test: the "form opens" case asserted only
 * that *some* element matched /New Connection/i, which the sidebar button
 * itself satisfies whether or not the form ever rendered.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import App from '../../../src/renderer/src/App';
import { useConnectionStore } from '../../../src/renderer/src/stores/connection-store';
import { useTerminalStore } from '../../../src/renderer/src/stores/terminal-store';
import { useUIStore } from '../../../src/renderer/src/stores/ui-store';
import { installFakeApi } from '../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}));

let api: ReturnType<typeof installFakeApi>;
let queryClient: QueryClient;

function renderApp(): void {
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const connection = {
  id: 'c1',
  name: 'prod-db',
  provider: 'sftp' as const,
  host: 'db.example.com',
  port: 22,
  username: 'root',
  authType: 'password' as const,
};

beforeEach(() => {
  api = installFakeApi();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useUIStore.setState({ activeView: 'terminal', sidebarOpen: true, settingsOpen: false });
  useTerminalStore.setState({ tabOrder: [], sessions: new Map(), activeSessionId: null });
  useConnectionStore.setState({ connectionFormOpen: false, editingConnectionId: null });
});

describe('connections integration', () => {
  it('shows the welcome view when there are no connections', async () => {
    renderApp();
    expect(await screen.findByText(/Welcome to Luna/i)).toBeInTheDocument();
  });

  it('lists saved connections in the sidebar', async () => {
    (api.connections.list as ReturnType<typeof vi.fn>).mockResolvedValue([connection]);
    renderApp();
    expect(await screen.findByText('prod-db')).toBeInTheDocument();
  });

  it('opens a real connection form when "New connection" is clicked', async () => {
    renderApp();
    await screen.findByLabelText(/New connection/i);
    fireEvent.click(screen.getByLabelText(/New connection/i));

    // Assert against the dialog itself, not just a text match anywhere on the
    // page — the sidebar button also matches /New Connection/i, so the old
    // assertion passed whether or not the form rendered.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/New Connection/i)).toBeInTheDocument();
    // And the form is actually usable: its fields are present.
    expect(within(dialog).getByLabelText(/Connection Name/i)).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('My Server')).toBeInTheDocument();
    expect(useConnectionStore.getState().connectionFormOpen).toBe(true);
  });

  it('closes the form again on Escape without creating anything', async () => {
    renderApp();
    fireEvent.click(await screen.findByLabelText(/New connection/i));
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(useConnectionStore.getState().connectionFormOpen).toBe(false));
    expect(api.connections.create).not.toHaveBeenCalled();
  });

  it('surfaces an empty sidebar rather than crashing when the list request fails', async () => {
    (api.connections.list as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('database is locked'),
    );
    renderApp();
    // The app must still boot — a failed connections query is not fatal.
    expect(await screen.findByText(/Welcome to Luna/i)).toBeInTheDocument();
  });
});
