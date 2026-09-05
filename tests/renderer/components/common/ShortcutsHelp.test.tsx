// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShortcutsHelp } from '../../../../src/renderer/src/components/common/ShortcutsHelp';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';

beforeEach(() => {
  useUIStore.setState({ shortcutsHelpOpen: false });
});

describe('ShortcutsHelp', () => {
  it('stays hidden until opened', () => {
    render(<ShortcutsHelp />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders as a labelled modal dialog when open', () => {
    useUIStore.setState({ shortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('shortcuts-help-title');
  });

  it('gives the close button an accessible name', () => {
    useUIStore.setState({ shortcutsHelpOpen: true });
    render(<ShortcutsHelp />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  // Regression for UX-1: this dialog previously had no focus trap or Escape
  // handler at all, so Tab leaked into the page behind it and Esc did nothing.
  it('closes on Escape', () => {
    useUIStore.setState({ shortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(useUIStore.getState().shortcutsHelpOpen).toBe(false);
  });

  it('closes when the close button is clicked', () => {
    useUIStore.setState({ shortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(useUIStore.getState().shortcutsHelpOpen).toBe(false);
  });

  it('closes on backdrop click', () => {
    useUIStore.setState({ shortcutsHelpOpen: true });
    render(<ShortcutsHelp />);

    // Queried off document.body, not the render container: DialogShell portals
    // its overlay so an ancestor's overflow/transform can't clip it.
    const overlay = document.body.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);

    expect(useUIStore.getState().shortcutsHelpOpen).toBe(false);
  });
});
