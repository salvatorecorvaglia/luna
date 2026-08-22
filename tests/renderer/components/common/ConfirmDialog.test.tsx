// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../../../src/renderer/src/components/common/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText('Delete?')).toBeNull();
  });

  it('renders the title and message with correct aria wiring when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-message');
  });

  it('calls onConfirm/onCancel from their respective buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on a backdrop click — only Esc or the explicit buttons', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows the destructive icon and styling only when destructive is set', () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveClass('btn-destructive');

    rerender(
      <ConfirmDialog
        open
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-destructive');
  });

  it('portals to document.body, decoupled from its React parent', () => {
    const { container } = render(
      <div data-testid="wrapper">
        <ConfirmDialog
          open
          title="Delete?"
          message="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );
    expect(
      container.querySelector('[data-testid="wrapper"]')?.contains(screen.getByText('Delete?')),
    ).toBe(false);
  });
});
