/**
 * Centralised z-index layering. Use these tokens instead of raw `z-50` or
 * `z-[1100]` so stacking is intentional and reviewable in one place.
 *
 * Values are spaced apart so a future layer can slot in without renumbering.
 * Each constant is a Tailwind arbitrary-value class so it can be dropped
 * straight into a `className`.
 */
export const Z = {
  /** In-page dropdowns/popovers (combobox results, menu surfaces). */
  dropdown: 'z-[50]',
  /** Tooltip overlays anchored to in-page elements. */
  tooltip: 'z-[60]',
  /** Standard modal dialogs (PromptDialog, FilePreview, ConnectionForm, etc.). */
  modal: 'z-[70]',
  /** Settings/side-panel sheets that take over the right edge of the window. */
  panel: 'z-[90]',
  /**
   * Host-key trust/change alert. Sits above standard modals so it surfaces
   * even when a ConnectionForm or other modal is open at the moment a
   * connect attempt triggers verification.
   */
  hostKeyDialog: 'z-[100]',
  /**
   * Confirmation dialogs that intentionally stack ABOVE another modal
   * (e.g. discard-changes prompt over an open ConnectionForm). Keep this
   * the highest *interactive* layer below toasts.
   */
  confirm: 'z-[110]',
  /**
   * Help tooltips that must surface above an open modal/form so contextual
   * hints are visible while a user is filling in a dialog. Sits below confirm
   * dialogs so a destructive prompt is never obscured.
   */
  tooltipOverlay: 'z-[100]',
  /** Drag chips and ephemeral floating UI during a drag gesture. */
  drag: 'z-[200]',
} as const;
