// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/renderer/src/components/terminal/TerminalToolbar', () => ({
  TerminalToolbar: () => null,
}));

import { TerminalTabs } from '../../../../src/renderer/src/components/terminal/TerminalTabs';
import {
  type TerminalSession,
  useTerminalStore,
} from '../../../../src/renderer/src/stores/terminal-store';
import { installFakeApi } from '../../../../src/test/fake-api';

const ssh = (id: string): TerminalSession => ({
  id,
  connectionId: `c-${id}`,
  connectionName: `Host ${id}`,
  status: 'connected',
  title: `Host ${id}`,
  type: 'ssh',
});

beforeEach(() => {
  installFakeApi();
  useTerminalStore.setState({
    sessions: new Map([
      ['a', ssh('a')],
      ['b', ssh('b')],
    ]),
    tabOrder: ['a', 'b'],
    layouts: new Map([
      ['a', { type: 'terminal', sessionId: 'a' }],
      ['b', { type: 'terminal', sessionId: 'b' }],
    ]),
    activeSessionId: 'a',
  });
});

describe('TerminalTabs — keyboard', () => {
  it('is a single Tab stop on the active tab', () => {
    render(<TerminalTabs />);
    expect(screen.getByRole('tab', { name: 'Host a' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Host b' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves between tabs with the arrow keys, selection following focus', () => {
    // Regression: tabs had role="tab" but could not be focused or navigated.
    render(<TerminalTabs />);
    const first = screen.getByRole('tab', { name: 'Host a' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(useTerminalStore.getState().activeSessionId).toBe('b');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Host b' }));

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(useTerminalStore.getState().activeSessionId).toBe('a');
  });
});
