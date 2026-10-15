// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The container's own behaviour is keyboard routing; its children mount xterm.
vi.mock('../../../../src/renderer/src/components/terminal/TerminalTabs', () => ({
  TerminalTabs: () => null,
}));
vi.mock('../../../../src/renderer/src/components/terminal/LocalTerminalTabs', () => ({
  LocalTerminalTabs: () => null,
}));
vi.mock('../../../../src/renderer/src/components/terminal/SplitLayout', () => ({
  SplitLayout: () => null,
}));

import { TerminalViewContainer } from '../../../../src/renderer/src/components/terminal/TerminalViewContainer';
import {
  type TerminalSession,
  useTerminalStore,
} from '../../../../src/renderer/src/stores/terminal-store';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';
import { installFakeApi } from '../../../../src/test/fake-api';

const SESSION: TerminalSession = {
  id: 's1',
  connectionId: 'c1',
  connectionName: 'prod',
  status: 'connected',
  title: 'prod',
  type: 'ssh',
};

function seed(status: TerminalSession['status']): void {
  useTerminalStore.setState({
    sessions: new Map([['s1', { ...SESSION, status }]]),
    tabOrder: ['s1'],
    layouts: new Map([['s1', { type: 'terminal', sessionId: 's1' }]]),
    activeSessionId: 's1',
  });
}

function pressCmdW(): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', metaKey: true, cancelable: true }),
    );
  });
}

describe('TerminalViewContainer — Cmd+W', () => {
  beforeEach(() => {
    installFakeApi();
    useUIStore.setState({ activeView: 'terminal' });
  });

  it('asks before disconnecting a live SSH session', () => {
    // Regression: Cmd+W called closeTab() directly, skipping the confirmation
    // the tab's X button shows for a connected session.
    seed('connected');
    render(<TerminalViewContainer type="ssh" />);

    pressCmdW();

    expect(useTerminalStore.getState().sessions.has('s1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(useTerminalStore.getState().sessions.has('s1')).toBe(false);
  });

  it('closes a dead session without asking', () => {
    seed('disconnected');
    render(<TerminalViewContainer type="ssh" />);
    pressCmdW();
    expect(useTerminalStore.getState().sessions.has('s1')).toBe(false);
  });

  it('does nothing while a modal is open', () => {
    seed('disconnected');
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      render(<TerminalViewContainer type="ssh" />);
      pressCmdW();
      expect(useTerminalStore.getState().sessions.has('s1')).toBe(true);
    } finally {
      modal.remove();
    }
  });
});
