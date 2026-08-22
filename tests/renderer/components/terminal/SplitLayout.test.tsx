// @vitest-environment jsdom
import type { PaneNode } from '@shared/types/terminal';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/terminal/TerminalPane', () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => (
    <input aria-label={`terminal-input-${sessionId}`} />
  ),
}));
vi.mock('@/components/terminal/LocalTerminalPane', () => ({
  LocalTerminalPane: ({ sessionId }: { sessionId: string }) => (
    <input aria-label={`terminal-input-${sessionId}`} />
  ),
}));

import { SplitLayout } from '../../../../src/renderer/src/components/terminal/SplitLayout';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';

const NODE: PaneNode = { type: 'terminal', sessionId: 'sess-1' };

beforeEach(() => {
  useTerminalStore.setState({
    sessions: new Map([
      [
        'sess-1',
        {
          id: 'sess-1',
          connectionId: 'c1',
          connectionName: 'Server 1',
          status: 'connected',
          title: 'Server 1',
          type: 'ssh',
        },
      ],
    ]),
    activeSessionId: null,
  });
});

describe('SplitLayout pane activation', () => {
  it('activates the pane on click', () => {
    render(<SplitLayout node={NODE} tabId="tab-1" activeSessionId={null} />);

    screen.getByLabelText('terminal-input-sess-1').closest('div')!.click();

    expect(useTerminalStore.getState().activeSessionId).toBe('sess-1');
  });

  // Regression for UX-4: xterm's own input is independently focusable, so a
  // keyboard user tabbing into a pane (rather than clicking it) must also
  // mark it active — otherwise "active session" state silently diverges from
  // where the user is actually typing.
  it('activates the pane when a descendant receives focus without a click', () => {
    render(<SplitLayout node={NODE} tabId="tab-1" activeSessionId={null} />);

    screen.getByLabelText('terminal-input-sess-1').focus();

    expect(useTerminalStore.getState().activeSessionId).toBe('sess-1');
  });

  it('does not call setActiveSession again once the pane is already active', () => {
    const realSetActiveSession = useTerminalStore.getState().setActiveSession;
    const setActiveSession = vi.fn();
    useTerminalStore.setState({ setActiveSession });

    try {
      render(<SplitLayout node={NODE} tabId="tab-1" activeSessionId="sess-1" />);
      screen.getByLabelText('terminal-input-sess-1').focus();

      expect(setActiveSession).not.toHaveBeenCalled();
    } finally {
      useTerminalStore.setState({ setActiveSession: realSetActiveSession });
    }
  });
});
