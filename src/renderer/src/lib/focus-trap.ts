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
export function attachFocusTrap(
  container: HTMLElement,
  options: { onEscape?: () => void } = {},
): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && options.onEscape) {
      options.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(container);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
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
