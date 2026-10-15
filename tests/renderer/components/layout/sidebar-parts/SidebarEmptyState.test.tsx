// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarEmptyState } from '../../../../../src/renderer/src/components/layout/sidebar-parts/SidebarEmptyState';

describe('SidebarEmptyState', () => {
  it('offers to add a first connection when there are none', () => {
    render(<SidebarEmptyState hasQuery={false} onCreate={vi.fn()} />);
    expect(screen.getByText('No connections')).toBeInTheDocument();
  });

  it('says the connections are hidden, and offers to show them, when all are hidden', () => {
    // Regression: it claimed "No connections — add your first" while every
    // saved connection was merely hidden.
    const onShowHidden = vi.fn();
    render(
      <SidebarEmptyState
        hasQuery={false}
        onCreate={vi.fn()}
        allHidden
        onShowHidden={onShowHidden}
      />,
    );
    expect(screen.getByText('All connections are hidden')).toBeInTheDocument();
    expect(screen.queryByText(/add your first/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden connections' }));
    expect(onShowHidden).toHaveBeenCalled();
  });
});
