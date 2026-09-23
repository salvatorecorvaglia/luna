// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// AnimatePresence keeps the exiting node mounted (mid opacity-0 transition)
// rather than removing it synchronously, which jsdom never advances past —
// stripped here so "hides on X" assertions can check DOM absence directly.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    // biome-ignore lint/suspicious/noExplicitAny: test-only prop passthrough
    div: ({ initial, animate, exit, transition, variants, children, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

import { HelpTooltip } from '../../../../src/renderer/src/components/common/HelpTooltip';

describe('HelpTooltip', () => {
  it('is hidden until hovered or focused', () => {
    render(<HelpTooltip content="Helpful info" />);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('reveals content on hover', () => {
    render(<HelpTooltip content="Helpful info" />);
    fireEvent.mouseEnter(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toBe('Helpful info');
  });

  // Regression for UX-3: the trigger previously wasn't focusable at all
  // (a bare icon with mouse-only handlers), so keyboard-only users had no way
  // to reveal the tooltip.
  it('reveals content on keyboard focus, not just hover', () => {
    render(<HelpTooltip content="Helpful info" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').textContent).toBe('Helpful info');
  });

  it('hides content on blur', () => {
    render(<HelpTooltip content="Helpful info" />);
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides content on Escape while focused', () => {
    render(<HelpTooltip content="Helpful info" />);
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('links the trigger to the tooltip content for screen readers', () => {
    render(<HelpTooltip content="Helpful info" />);
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });
});
