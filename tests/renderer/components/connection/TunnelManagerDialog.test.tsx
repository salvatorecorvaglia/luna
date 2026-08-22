// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TunnelManagerDialog } from '../../../../src/renderer/src/components/connection/TunnelManagerDialog';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const TUNNEL = {
  id: 't1',
  sessionId: 'sess-1',
  type: 'local' as const,
  bindAddress: '127.0.0.1',
  localPort: 8080,
  remoteHost: 'localhost',
  remotePort: 80,
  status: 'active' as const,
  activeConnections: 2,
  bytesRead: 1024,
  bytesWritten: 512,
};

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
});

describe('TunnelManagerDialog', () => {
  it('renders nothing when closed', () => {
    render(<TunnelManagerDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Active Port Forwards & Tunnels')).toBeNull();
  });

  it('loads and lists active tunnels', async () => {
    (api.ssh.listActivePortForwards as ReturnType<typeof vi.fn>).mockResolvedValue([TUNNEL]);
    render(<TunnelManagerDialog open onClose={vi.fn()} />);
    await screen.findByText('127.0.0.1:8080');
    expect(screen.getByText('localhost:80')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows the empty state with no active tunnels', async () => {
    render(<TunnelManagerDialog open onClose={vi.fn()} />);
    await screen.findByText('No active port forwards');
  });

  it('stops a tunnel via ssh.stopPortForward', async () => {
    (api.ssh.listActivePortForwards as ReturnType<typeof vi.fn>).mockResolvedValue([TUNNEL]);
    render(<TunnelManagerDialog open onClose={vi.fn()} />);
    await screen.findByText('127.0.0.1:8080');

    fireEvent.click(screen.getByTitle('Stop tunnel'));

    await vi.waitFor(() =>
      expect(api.ssh.stopPortForward).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        forwardId: 't1',
      }),
    );
  });

  it('starts a new tunnel from the add-tunnel form', async () => {
    (api.app.getActiveSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      ssh: [{ id: 'sess-1', connectionId: 'conn-1' }],
      s3: [],
    });
    render(<TunnelManagerDialog open onClose={vi.fn()} />);
    await screen.findByRole('button', { name: /New Tunnel/ });

    fireEvent.click(screen.getByRole('button', { name: /New Tunnel/ }));
    fireEvent.change(screen.getByLabelText('Local Port'), { target: { value: '9090' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Tunnel/ }));

    await vi.waitFor(() =>
      expect(api.ssh.startPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          config: expect.objectContaining({ type: 'local', localPort: 9090 }),
        }),
      ),
    );
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<TunnelManagerDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the footer Close button', () => {
    const onClose = vi.fn();
    render(<TunnelManagerDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
