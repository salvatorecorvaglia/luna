/**
 * Selector for elements that participate in tab order inside a dialog focus trap.
 * Includes textarea/select/contenteditable in addition to input/button so the
 * trap doesn't leak through richer fields.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  '[contenteditable=""]:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Wire a Tab/Shift-Tab focus trap onto `container`. Call from inside a useEffect
 * and return the cleanup. The handler also fires on Escape via `onEscape` if given.
 *
 * On attach, the previously-focused element is captured. On cleanup, focus is
 * restored to it if it's still in the document — this keeps keyboard users
 * from being dropped onto `<body>` when a modal closes.
 */
/**
 * Traps currently attached, outermost first. The last entry is the one the user
 * is actually interacting with.
 *
 * Every trap listens on `window`, so with two dialogs open both handlers ran on
 * every key. Dialogs stack by design — z-layers.ts documents `Z.confirm` as
 * existing precisely so a confirmation can sit above another modal, and
 * ConnectionForm renders exactly that pair. The consequences, observed against
 * the built app:
 *
 *  - Tab inside the top dialog moved focus into the dialog *behind* it. The
 *    outer trap sees `document.activeElement` outside its own container (the
 *    confirm dialog is a sibling portal, not a descendant), concludes focus has
 *    escaped, and pulls it back to its own first field.
 *  - Escape reached every trap at once. ConnectionForm happens to mask this —
 *    its onEscape re-raises the still-dirty discard prompt — but a stacked pair
 *    whose outer onClose closes unconditionally would have both dismissed on one
 *    keypress.
 *
 * Only the topmost trap handles a key; the rest stay attached (so they still
 * restore focus correctly on cleanup) but ignore it.
 */
const trapStack: object[] = [];

export function attachFocusTrap(
  container: HTMLElement,
  options: { onEscape?: () => void } = {},
): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  /** Identity for this trap's position in the stack. */
  const token = {};
  trapStack.push(token);

  const handler = (e: KeyboardEvent): void => {
    // Not the top of the stack: a dialog above this one owns the keyboard.
    if (trapStack[trapStack.length - 1] !== token) return;

    if (e.key === 'Escape' && options.onEscape) {
      options.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(container);
    if (focusable.length === 0) return;
    // Non-null: the length check above guarantees both ends exist.
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    // If focus has escaped the container entirely (e.g. moved to body), pull it back.
    if (!active || !container.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('keydown', handler);
    // Remove by identity, not by popping: traps can be torn down out of order
    // (React unmount order is not guaranteed to mirror mount order), and
    // popping blindly would hand control to the wrong dialog.
    const index = trapStack.lastIndexOf(token);
    if (index !== -1) trapStack.splice(index, 1);
    // Restore focus only if the trigger is still in the DOM and focusable.
    // `preventScroll: true` so a re-focused button doesn't yank the page.
    if (previouslyFocused && document.contains(previouslyFocused)) {
      try {
        previouslyFocused.focus({ preventScroll: true });
      } catch {
        // Some elements throw on focus (detached, no tabindex, etc.) — best-effort.
      }
    }
  };
}

/** Test-only: drop any traps a failed test left attached. */
export function __resetFocusTrapStack(): void {
  trapStack.length = 0;
}
