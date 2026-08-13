// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../../../src/test/fake-api';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';
import { SettingsPanel } from '../../../../src/renderer/src/components/common/SettingsPanel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
// The logo is imported as an asset URL; jsdom has no loader for it.
vi.mock('../../../../resources/luna.png', () => ({ default: 'luna.png' }));

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPanel />
    </QueryClientProvider>,
  );
}

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
  useUIStore.setState({ settingsOpen: true });
});

/** Every persisted setting goes through settings.set as a JSON-encoded string. */
function settingWrites(): [string, string][] {
  return (api.settings.set as unknown as { mock: { calls: [string, string][] } }).mock.calls;
}

describe('SettingsPanel — persistence', () => {
  it('loads stored values on open rather than showing defaults', async () => {
    (api.settings.getAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      'ssh.maxReconnectAttempts': 9,
      'transfer.concurrency': 7,
    });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('Max reconnect attempts')).toHaveValue('9'));
    expect(screen.getByLabelText('Concurrent transfers')).toHaveValue('7');
  });

  it('persists a toggle as JSON so the main-side parser accepts it', async () => {
    renderPanel();
    const autoReconnect = await screen.findByRole('switch', { name: /auto-reconnect/i });

    fireEvent.click(autoReconnect);

    await waitFor(() => expect(settingWrites()).toContainEqual(['ssh.autoReconnect', 'false']));
  });

  it('persists a stepper value as a JSON number, not a string', async () => {
    // SETTINGS_SET type-checks the decoded value, so '"5"' would be rejected.
    renderPanel();
    const decrease = await screen.findByLabelText('Decrease Concurrent transfers');

    fireEvent.click(decrease);

    await waitFor(() => {
      const write = settingWrites().find(([k]) => k === 'transfer.concurrency');
      expect(write).toBeDefined();
      expect(JSON.parse(write![1])).toBeTypeOf('number');
    });
  });
});

describe('SettingsPanel — public port-forward bind', () => {
  it('is off by default and describes the exposure', async () => {
    renderPanel();
    const toggle = await screen.findByRole('switch', {
      name: /allow public port-forward binds/i,
    });

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // A security-relevant switch needs to say what it does, not just name itself.
    expect(screen.getByText(/reachable from other machines/i)).toBeTruthy();
  });

  it('persists the opt-in when enabled', async () => {
    renderPanel();
    const toggle = await screen.findByRole('switch', {
      name: /allow public port-forward binds/i,
    });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(settingWrites()).toContainEqual(['ssh.allowPublicPortForwardBind', 'true']),
    );
  });
});

describe('SettingsPanel — reconnect controls', () => {
  it('disables the attempt count when auto-reconnect is off', async () => {
    (api.settings.getAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      'ssh.autoReconnect': false,
    });
    renderPanel();

    // The attempts setting refines auto-reconnect; leaving it live while
    // reconnection is off implies it still does something.
    await waitFor(() => expect(screen.getByLabelText('Max reconnect attempts')).toBeDisabled());
  });

  it('keeps the attempt count live when auto-reconnect is on', async () => {
    (api.settings.getAll as ReturnType<typeof vi.fn>).mockResolvedValue({
      'ssh.autoReconnect': true,
    });
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('Max reconnect attempts')).not.toBeDisabled());
  });
});

describe('SettingsPanel — destructive actions', () => {
  it('requires confirmation before deleting all connections', async () => {
    renderPanel();
    const deleteAll = await screen.findByRole('button', { name: /delete all/i });

    fireEvent.click(deleteAll);

    // The click opens a confirm; it must not call through on its own.
    expect(api.connections.deleteAll).not.toHaveBeenCalled();
    // ConfirmDialog renders as role="dialog" (same as the panel), so match on
    // its confirm affordance rather than the role.
    expect(await screen.findByRole('button', { name: 'Delete All' })).toBeTruthy();
  });

  it('deletes only after the confirm is accepted', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /delete all/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete All' }));

    await waitFor(() => expect(api.connections.deleteAll).toHaveBeenCalledTimes(1));
  });
});

describe('SettingsPanel — visibility', () => {
  it('renders nothing while closed', () => {
    useUIStore.setState({ settingsOpen: false });
    renderPanel();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on the header button', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Close settings'));
    await waitFor(() => expect(useUIStore.getState().settingsOpen).toBe(false));
  });
});
