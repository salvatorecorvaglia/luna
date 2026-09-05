// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from '../../../../src/renderer/src/components/layout/TitleBar';
import { useUIStore } from '../../../../src/renderer/src/stores/ui-store';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('../../../../resources/luna.png', () => ({ default: 'luna.png' }));

beforeEach(() => {
  installFakeApi();
  useUIStore.setState({ activeView: 'terminal' });
});

/**
 * The view switcher is the app's primary navigation but was three plain
 * buttons: no aria-selected, no arrow-key movement, and nothing telling
 * assistive tech which view was current. TerminalTabs already did this
 * correctly, so the app carried two patterns for the same job.
 */
describe('TitleBar view switcher', () => {
  it('exposes the views as a tablist', () => {
    render(<TitleBar />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks only the current view as selected', () => {
    render(<TitleBar />);
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Local' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'SFTP' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps exactly one tab in the tab order', () => {
    render(<TitleBar />);
    const tabbable = screen.getAllByRole('tab').filter((t) => t.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName('Terminal');
  });

  it('still has one tab stop on a view with no tab of its own', () => {
    useUIStore.setState({ activeView: 'welcome' });
    render(<TitleBar />);
    const tabbable = screen.getAllByRole('tab').filter((t) => t.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('clicking a tab switches the view', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByRole('tab', { name: 'SFTP' }));
    expect(useUIStore.getState().activeView).toBe('sftp');
  });

  it('moves between views with the arrow keys, wrapping at the ends', () => {
    render(<TitleBar />);
    const tablist = screen.getByRole('tablist', { name: 'View' });

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(useUIStore.getState().activeView).toBe('sftp');

    // Wraps forward past the last tab.
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(useUIStore.getState().activeView).toBe('local');

    // And backward past the first.
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(useUIStore.getState().activeView).toBe('sftp');
  });

  it('jumps to the first and last view with Home and End', () => {
    render(<TitleBar />);
    const tablist = screen.getByRole('tablist', { name: 'View' });

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(useUIStore.getState().activeView).toBe('sftp');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(useUIStore.getState().activeView).toBe('local');
  });

  it('ignores keys it does not own', () => {
    render(<TitleBar />);
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'View' }), { key: 'a' });
    expect(useUIStore.getState().activeView).toBe('terminal');
  });
});
