// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogShell } from '../../../../src/renderer/src/components/common/DialogShell';

describe('DialogShell', () => {
  it('renders nothing when closed', () => {
    render(
      <DialogShell open={false} onClose={vi.fn()} zLayer="z-[70]">
        <div>content</div>
      </DialogShell>,
    );
    expect(screen.queryByText('content')).toBeNull();
  });

  it('renders children with the given role/aria wiring when open', () => {
    render(
      <DialogShell
        open
        onClose={vi.fn()}
        zLayer="z-[70]"
        ariaLabelledBy="t"
        ariaDescribedBy="d"
        role="alertdialog"
      >
        <h3 id="t">Title</h3>
        <p id="d">Description</p>
      </DialogShell>,
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 't');
    expect(dialog).toHaveAttribute('aria-describedby', 'd');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <DialogShell open onClose={onClose} zLayer="z-[70]">
        <div>content</div>
      </DialogShell>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on overlay click by default', () => {
    const onClose = vi.fn();
    render(
      <DialogShell open onClose={onClose} zLayer="z-[70]">
        <div>content</div>
      </DialogShell>,
    );
    // The panel wrapper covers the overlay; clicking it directly (not the
    // stopPropagation'd inner card) simulates a backdrop click.
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses on overlay click when dismissOnOverlayClick is set', () => {
    const onClose = vi.fn();
    render(
      <DialogShell open onClose={onClose} zLayer="z-[70]" dismissOnOverlayClick>
        <div>content</div>
      </DialogShell>,
    );
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when a click on the card is stopped from propagating', () => {
    const onClose = vi.fn();
    render(
      <DialogShell open onClose={onClose} zLayer="z-[70]" dismissOnOverlayClick>
        <div>content</div>
      </DialogShell>,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('invokes onOpenFocus with the dialog element after opening', async () => {
    const onOpenFocus = vi.fn();
    render(
      <DialogShell open onClose={vi.fn()} zLayer="z-[70]" onOpenFocus={onOpenFocus}>
        <div>content</div>
      </DialogShell>,
    );
    await vi.waitFor(() => expect(onOpenFocus).toHaveBeenCalledTimes(1));
    expect(onOpenFocus.mock.calls[0][0]).toBe(screen.getByRole('dialog'));
  });

  it('renders inline (not portaled) when portal is false', () => {
    const { container } = render(
      <div data-testid="wrapper">
        <DialogShell open onClose={vi.fn()} zLayer="z-[70]" portal={false}>
          <div>content</div>
        </DialogShell>
      </div>,
    );
    expect(container.querySelector('[data-testid="wrapper"]')?.contains(screen.getByText('content'))).toBe(
      true,
    );
  });

  it('portals to document.body by default', () => {
    const { container } = render(
      <div data-testid="wrapper">
        <DialogShell open onClose={vi.fn()} zLayer="z-[70]">
          <div>content</div>
        </DialogShell>
      </div>,
    );
    expect(
      container.querySelector('[data-testid="wrapper"]')?.contains(screen.getByText('content')),
    ).toBe(false);
    expect(document.body.contains(screen.getByText('content'))).toBe(true);
  });
});
