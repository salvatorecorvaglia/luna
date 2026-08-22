// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptDialog } from '../../../../src/renderer/src/components/common/PromptDialog';

describe('PromptDialog', () => {
  it('confirms with the edited value', () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        open
        title="Rename tab"
        defaultValue="old-name"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new-name' } });
    fireEvent.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith('new-name');
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<PromptDialog open title="Rename tab" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });

  // Regression for UX-6: the overlay div previously carried the dismiss
  // handler, but the inset-0 panel wrapper rendered on top of it and
  // intercepted every click first — the handler never actually fired.
  it('cancels on backdrop click', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <PromptDialog open title="Rename tab" onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    const panel = container.querySelector('.fixed.inset-0.flex') as HTMLElement;
    expect(panel).toBeTruthy();
    fireEvent.click(panel);

    expect(onCancel).toHaveBeenCalled();
  });

  it('does not cancel when clicking inside the dialog card', () => {
    const onCancel = vi.fn();
    render(<PromptDialog open title="Rename tab" onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('dialog'));

    expect(onCancel).not.toHaveBeenCalled();
  });
});
