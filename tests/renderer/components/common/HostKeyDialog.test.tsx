// @vitest-environment jsdom
import type { SshHostKeyChangeEvent } from '@shared/types/terminal';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trustHostKey = vi.fn();
const connectToHost = vi.fn();
let hostKeyListener: ((payload: SshHostKeyChangeEvent) => void) | null = null;

vi.mock('@/lib/ssh', () => ({ connectToHost: (...args: unknown[]) => connectToHost(...args) }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { HostKeyDialog } from '../../../../src/renderer/src/components/common/HostKeyDialog';

const CHANGED_KEY_EVENT: SshHostKeyChangeEvent = {
  sessionId: 's1',
  connectionId: 'c1',
  host: 'example.com',
  port: 22,
  storedFingerprint: 'OLDoldOLDoldOLDoldOLDoldOLDoldOLDoldOLDoldA',
  newFingerprint: 'NEWnewNEWnewNEWnewNEWnewNEWnewNEWnewNEWnewB',
  algorithm: 'ssh-ed25519',
  isFirst: false,
};

const FIRST_USE_EVENT: SshHostKeyChangeEvent = {
  ...CHANGED_KEY_EVENT,
  storedFingerprint: '',
  isFirst: true,
};

beforeEach(() => {
  trustHostKey.mockReset().mockResolvedValue({ trusted: true, fingerprint: 'fp' });
  connectToHost.mockReset();
  hostKeyListener = null;

  (window as unknown as { api: unknown }).api = {
    ssh: {
      onHostKeyChange: (cb: (payload: SshHostKeyChangeEvent) => void) => {
        hostKeyListener = cb;
        return () => {
          hostKeyListener = null;
        };
      },
      trustHostKey,
    },
  };
});

/** Render and push a host-key event through the IPC listener. */
async function showDialog(event: SshHostKeyChangeEvent): Promise<void> {
  render(<HostKeyDialog />);
  await waitFor(() => expect(hostKeyListener).toBeTypeOf('function'));
  hostKeyListener!(event);
  await screen.findByRole('alertdialog');
}

describe('HostKeyDialog', () => {
  it('stays hidden until a host-key event arrives', () => {
    render(<HostKeyDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows both fingerprints when a known host key has changed', async () => {
    await showDialog(CHANGED_KEY_EVENT);
    expect(screen.getByText(/Host Key Changed/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(CHANGED_KEY_EVENT.newFingerprint))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(CHANGED_KEY_EVENT.storedFingerprint))).toBeInTheDocument();
    expect(screen.getByText(/man-in-the-middle/i)).toBeInTheDocument();
  });

  it('renders fingerprints with the SHA256: prefix OpenSSH uses', async () => {
    await showDialog(FIRST_USE_EVENT);
    expect(screen.getByText(/SHA256:NEWnew/)).toBeInTheDocument();
  });

  it('frames a never-seen host as first-use rather than a key change', async () => {
    await showDialog(FIRST_USE_EVENT);
    expect(screen.getByText(/Unknown Host/i)).toBeInTheDocument();
    expect(screen.queryByText(/man-in-the-middle/i)).toBeNull();
  });

  // The security-critical assertion: Reject must never trust the key.
  it('does not trust the key when the user rejects', async () => {
    await showDialog(CHANGED_KEY_EVENT);

    fireEvent.click(screen.getByText('Reject'));

    expect(trustHostKey).not.toHaveBeenCalled();
    expect(connectToHost).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('defaults focus to Reject, not to the trust action', async () => {
    await showDialog(CHANGED_KEY_EVENT);
    // The destructive default matters: hitting Enter reflexively must not
    // accept a changed host key.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain('Reject');
    });
  });

  it('trusts the key and reconnects only on explicit confirmation', async () => {
    await showDialog(CHANGED_KEY_EVENT);

    fireEvent.click(screen.getByText('Trust New Key'));

    await waitFor(() =>
      expect(trustHostKey).toHaveBeenCalledWith({
        host: 'example.com',
        port: 22,
        // Trust is bound to the key the dialog displayed.
        fingerprint: CHANGED_KEY_EVENT.newFingerprint,
      }),
    );
    // No tab for 's1' exists in this test, so a fresh connection is opened.
    await waitFor(() => expect(connectToHost).toHaveBeenCalledWith('c1'));
  });

  it('reconnects the session that raised the prompt instead of opening a new tab', async () => {
    // Regression: connectToHost() spawned a second session and left the
    // original tab (or split pane) stuck in `error`.
    const connect = vi.fn().mockResolvedValue({ success: true });
    (window as unknown as { api: { ssh: Record<string, unknown> } }).api.ssh.connect = connect;
    const { useTerminalStore } = await import('../../../../src/renderer/src/stores/terminal-store');
    useTerminalStore.setState({
      sessions: new Map([
        [
          's1',
          {
            id: 's1',
            connectionId: 'c1',
            connectionName: 'prod',
            status: 'error',
            title: 'prod',
            type: 'ssh',
          },
        ],
      ]),
    });
    await showDialog(CHANGED_KEY_EVENT);

    fireEvent.click(screen.getByText('Trust New Key'));

    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith({ connectionId: 'c1', sessionId: 's1' }),
    );
    expect(connectToHost).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessions.get('s1')?.status).toBe('connecting');
    useTerminalStore.setState({ sessions: new Map() });
  });

  it('does not reconnect when trusting fails', async () => {
    trustHostKey.mockResolvedValue({ trusted: false });
    await showDialog(CHANGED_KEY_EVENT);

    fireEvent.click(screen.getByText('Trust New Key'));

    await waitFor(() => expect(trustHostKey).toHaveBeenCalled());
    expect(connectToHost).not.toHaveBeenCalled();
  });

  // Regression for UX-6: rejecting on outside-click mirrors the existing
  // Escape behavior — reject is always the safe, non-destructive default.
  it('rejects (without trusting) on backdrop click', async () => {
    await showDialog(CHANGED_KEY_EVENT);

    const panel = document.querySelector('.fixed.inset-0.flex') as HTMLElement;
    expect(panel).toBeTruthy();
    fireEvent.click(panel);

    expect(trustHostKey).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

describe('HostKeyDialog — several prompts at once', () => {
  it('queues a second host instead of overwriting the first', async () => {
    // Regression: one pending slot, so the second prompt replaced the first
    // and that host's prompt was lost until retried.
    await showDialog({ ...FIRST_USE_EVENT, host: 'one.example.com' });
    hostKeyListener!({ ...FIRST_USE_EVENT, host: 'two.example.com' });

    expect(await screen.findByText(/one\.example\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reject'));
    expect(await screen.findByText(/two\.example\.com/)).toBeInTheDocument();
  });
});
