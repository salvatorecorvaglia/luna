// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../../../src/test/fake-api';
import { useConnectionStore } from '../../../../src/renderer/src/stores/connection-store';
import { ConnectionForm } from '../../../../src/renderer/src/components/connection/ConnectionForm';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let api: ReturnType<typeof installFakeApi>;

/** The submit button is disabled until useConnections() settles. */
async function submitButton(): Promise<HTMLElement> {
  const button = await screen.findByRole('button', { name: /^(save|create|update)/i });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

function renderForm(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectionForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api = installFakeApi();
  useConnectionStore.setState({
    connectionFormOpen: true,
    editingConnectionId: null,
    duplicatingConnectionId: null,
  });
});

describe('ConnectionForm — visibility', () => {
  it('renders nothing while closed', () => {
    useConnectionStore.setState({ connectionFormOpen: false });
    renderForm();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on the SFTP provider by default', async () => {
    renderForm();
    await screen.findByRole('dialog');
    expect(screen.getByLabelText(/host/i)).toBeTruthy();
  });
});

describe('ConnectionForm — provider switching', () => {
  it('swaps the field set when S3 is selected', async () => {
    renderForm();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('radio', { name: /s3/i }));

    // SSH-only fields must not linger once the provider changes, or a save
    // would carry values the S3 branch never validates.
    await waitFor(() => expect(screen.getByLabelText(/access key id/i)).toBeTruthy());
    expect(screen.queryByLabelText(/^username/i)).toBeNull();
  });
});

describe('ConnectionForm — save', () => {
  it('does not submit an empty form', async () => {
    renderForm();
    await screen.findByRole('dialog');

    fireEvent.click(await submitButton());

    await waitFor(() => expect(api.connections.create).not.toHaveBeenCalled());
    // Submitting must reveal the per-field errors rather than failing silently.
    // Submitting must reveal the per-field errors rather than failing silently.
    expect(await screen.findByText(/host is required/i)).toBeTruthy();
    expect(await screen.findByText(/username is required/i)).toBeTruthy();
  });

  it('creates a connection from the filled SFTP fields', async () => {
    renderForm();
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText(/connection name/i), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'deploy' } });
    // The default auth type is password, and a password is required on create.
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'hunter2' } });
    fireEvent.click(await submitButton());

    await waitFor(() => expect(api.connections.create).toHaveBeenCalledTimes(1));
    const [input] = (api.connections.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(input).toMatchObject({ name: 'prod', host: 'example.com', username: 'deploy' });
  });
});

describe('ConnectionForm — test connection', () => {
  it('refuses to test before host and username are filled', async () => {
    renderForm();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    // The guard is client-side; no IPC should be issued at all.
    await waitFor(() => expect(screen.getByText(/host and username are required/i)).toBeTruthy());
    expect(api.ssh.testConnection).not.toHaveBeenCalled();
  });

  it('reports a successful test inline rather than via a toast', async () => {
    renderForm();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'deploy' } });

    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(screen.getByText(/connection successful/i)).toBeTruthy());
  });

  it('surfaces the server-reported failure reason', async () => {
    (api.ssh.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'Authentication failed — check username, password, or key.',
    });
    renderForm();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'deploy' } });

    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(screen.getByText(/authentication failed/i)).toBeTruthy());
  });

  it('sends the typed credentials as a transient config, never a connectionId', async () => {
    // Mixing both is rejected main-side; the form must pick the config path so
    // an unsaved password is actually the thing being tested.
    renderForm();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'deploy' } });

    fireEvent.click(screen.getByRole('button', { name: /test/i }));

    await waitFor(() => expect(api.ssh.testConnection).toHaveBeenCalled());
    const [params] = (api.ssh.testConnection as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.config).toBeDefined();
    expect(params.connectionId).toBeUndefined();
  });
});
