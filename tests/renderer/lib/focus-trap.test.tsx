// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogShell } from '../../../src/renderer/src/components/common/DialogShell';

const __resetFocusTrapStack = () => {};

afterEach(() => {
  __resetFocusTrapStack();
});

/** Resolve after the next animation frame, where onOpenFocus runs. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Two DialogShells open at once — the arrangement z-layers.ts documents as
 * intentional (Z.confirm exists so a confirmation can stack over another
 * modal), and which ConnectionForm actually renders.
 */
function Stacked({
  onOuterClose,
  onInnerClose,
  innerOpen = true,
}: {
  onOuterClose: () => void;
  onInnerClose: () => void;
  innerOpen?: boolean;
}) {
  return (
    <>
      <DialogShell open onClose={onOuterClose} zLayer="z-[70]" portal={false}>
        <input data-testid="outer-input" />
        <button type="button">Outer button</button>
      </DialogShell>
      <DialogShell open={innerOpen} onClose={onInnerClose} zLayer="z-[110]" portal={false}>
        <button type="button" data-testid="inner-first">
          Cancel
        </button>
        <button type="button" data-testid="inner-middle">
          Middle
        </button>
        <button type="button" data-testid="inner-last">
          Confirm
        </button>
      </DialogShell>
    </>
  );
}

describe('stacked focus traps', () => {
  it('sends Escape only to the topmost dialog', () => {
    // Before the trap stack, every trap listened on window and all of them ran
    // on one keypress, so a single Escape could dismiss a confirmation and the
    // form underneath it together.
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    render(<Stacked onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });

  it('leaves Tab alone when focus is already mid-dialog in the top layer', () => {
    // The discriminating case. jsdom does not implement native tab movement, so
    // the only focus changes observable here are the ones a trap makes
    // deliberately.
    //
    // With focus on a control that is neither the first nor the last of the top
    // dialog, the correct behaviour is to do nothing at all and let Tab move
    // natively. The old code could not: the lower trap saw activeElement
    // outside its own container (the upper dialog is a sibling portal),
    // concluded focus had escaped, and called focus() on its own first field —
    // so focus jumped even though the top dialog had not asked for anything.
    render(<Stacked onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);

    const middle = screen.getByTestId('inner-middle');
    middle.focus();

    fireEvent.keyDown(window, { key: 'Tab' });

    expect(document.activeElement).toBe(middle);
  });

  it('hands control back to the lower dialog once the upper one closes', () => {
    const onOuterClose = vi.fn();
    const { rerender } = render(
      <Stacked onOuterClose={onOuterClose} onInnerClose={vi.fn()} innerOpen />,
    );

    rerender(<Stacked onOuterClose={onOuterClose} onInnerClose={vi.fn()} innerOpen={false} />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });
});

describe('DialogShell focus stability', () => {
  it('does not steal focus back when the parent re-renders', async () => {
    // onOpenFocus and onClose are routinely inline arrows, so they changed
    // identity every render. With them in the effect's deps the trap was torn
    // down and rebuilt and onOpenFocus fired again — moving focus off whatever
    // the user had tabbed to, on an unrelated parent render.
    function Parent() {
      const [, setTick] = useState(0);
      return (
        <>
          <button type="button" data-testid="rerender" onClick={() => setTick((t) => t + 1)}>
            rerender
          </button>
          <DialogShell
            open
            onClose={() => undefined}
            zLayer="z-[70]"
            portal={false}
            onOpenFocus={(dialog) => dialog.querySelector<HTMLElement>('[data-cancel]')?.focus()}
          >
            <button type="button" data-cancel data-testid="cancel">
              Cancel
            </button>
            <button type="button" data-testid="destructive">
              Delete
            </button>
          </DialogShell>
        </>
      );
    }

    render(<Parent />);

    // Let the dialog's initial onOpenFocus land first, otherwise the assertion
    // below races the mount frame rather than the re-render.
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByTestId('cancel'));

    // Now the user tabs to the destructive action.
    const destructive = screen.getByTestId('destructive');
    destructive.focus();
    expect(document.activeElement).toBe(destructive);

    fireEvent.click(screen.getByTestId('rerender'));

    // onOpenFocus runs inside requestAnimationFrame, so the assertion has to
    // wait for the frame — checking synchronously passes even against the old
    // implementation, which is exactly the trap this test exists to avoid.
    await nextFrame();

    expect(document.activeElement).toBe(destructive);
  });
});
