// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { Reorder } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { SessionTab } from '../../../../src/renderer/src/components/terminal/SessionTab';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';

describe('shared session tab', () => {
  it.each(['ssh', 'local'] as const)('closes a %s tab without activating it', (type) => {
    useTerminalStore.setState({
      sessions: new Map([
        [
          'session',
          {
            id: 'session',
            connectionId: 'connection',
            connectionName: 'Host',
            title: 'Work',
            type,
            status: 'connected',
          },
        ],
      ]),
      layouts: new Map([['tab', { type: 'terminal', sessionId: 'session' }]]),
    });
    const activate = vi.fn();
    const close = vi.fn();
    render(
      <Reorder.Group axis="x" values={['tab']} onReorder={() => {}}>
        <SessionTab
          tabId="tab"
          isActive={false}
          tabbable
          contextItems={[]}
          onActivate={activate}
          onClose={close}
        />
      </Reorder.Group>,
    );
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Close tab Work' }));
    expect(close).toHaveBeenCalledWith('tab');
    expect(activate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('tab'), { key: 'Enter' });
    expect(activate).toHaveBeenCalledWith('tab');
  });
});
