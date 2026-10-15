// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BroadcastInputBar } from '../../../../src/renderer/src/components/terminal/BroadcastInputBar';
import {
  type TerminalSession,
  useTerminalStore,
} from '../../../../src/renderer/src/stores/terminal-store';
import { installFakeApi } from '../../../../src/test/fake-api';

function seed(sessions: TerminalSession[]): void {
  useTerminalStore.setState({ sessions: new Map(sessions.map((s) => [s.id, s])) });
}

const ssh = (id: string, name: string): TerminalSession => ({
  id,
  connectionId: `conn-${id}`,
  connectionName: name,
  status: 'connected',
  title: name,
  type: 'ssh',
});

function send(text: string): void {
  fireEvent.change(screen.getByPlaceholderText(/type command/i), { target: { value: text } });
  fireEvent.submit(screen.getByPlaceholderText(/type command/i).closest('form')!);
}

describe('BroadcastInputBar', () => {
  let api: ReturnType<typeof installFakeApi>;

  beforeEach(() => {
    api = installFakeApi();
    seed([ssh('a', 'alpha'), ssh('b', 'bravo'), ssh('c', 'charlie')]);
  });

  it('targets every connected session by default', () => {
    render(<BroadcastInputBar open onClose={() => {}} />);
    send('uptime');
    expect(api.ssh.sendData).toHaveBeenCalledTimes(3);
  });

  it('sends only to the sessions left selected', () => {
    render(<BroadcastInputBar open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'bravo' }));
    send('reboot');
    expect(api.ssh.sendData).toHaveBeenCalledTimes(1);
    expect(api.ssh.sendData).toHaveBeenCalledWith({ sessionId: 'c', data: 'reboot\n' });
  });

  it('sends to nobody — and disables Send — after deselecting the last session', () => {
    // Regression: an empty selection meant "everyone", so deselecting the one
    // host a destructive command was narrowed to broadcast it to all of them.
    render(<BroadcastInputBar open onClose={() => {}} />);
    for (const name of ['alpha', 'bravo', 'charlie']) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    expect(screen.getByRole('button', { name: /send to 0/i })).toBeDisabled();
    send('rm -rf /tmp/x');
    expect(api.ssh.sendData).not.toHaveBeenCalled();
  });

  it('toggling "All" off selects none rather than staying on all', () => {
    render(<BroadcastInputBar open onClose={() => {}} />);
    const all = screen.getByRole('button', { name: /all \(3\)/i });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'false');
    send('ls');
    expect(api.ssh.sendData).not.toHaveBeenCalled();
  });

  it('routes local sessions through the local terminal channel', () => {
    seed([{ ...ssh('l', 'shell'), connectionId: 'local', type: 'local' }]);
    render(<BroadcastInputBar open onClose={() => {}} />);
    send('pwd');
    expect(api.localTerminal.sendData).toHaveBeenCalledWith({ sessionId: 'l', data: 'pwd\n' });
    expect(api.ssh.sendData).not.toHaveBeenCalled();
  });
});
