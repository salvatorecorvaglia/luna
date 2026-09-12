import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { attachFocusTrap } from '@/lib/focus-trap';

/**
 * Shared overlay/animation/focus-trap chrome for the app's modal dialogs.
 *
 * Before this existed, ~15 components each hand-rolled their own
 * `AnimatePresence` + overlay `motion.div` + panel `motion.div` +
 * `attachFocusTrap` wiring — near-identical, but independently drifted. One
 * concrete symptom: some dialogs rendered through `createPortal(...,
 * document.body)` and others rendered inline in the component tree, with no
 * functional reason for the split, so only some were immune to an ancestor's
 * `overflow`/`transform` clipping. `portal` here defaults to `true` so new
 * callers get the safer behavior unless they have a specific reason not to.
 *
 * This owns exactly the chrome — overlay, entrance/exit animation, stacking
 * layer, focus trap, Escape-to-close, and (opt-in) click-outside-to-close.
 * Everything that legitimately varies per dialog — initial focus target,
 * card width/padding, aria ids, role — stays a prop or lives in `children`.
 */

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.1 } },
} as const;

/** Slide-in used by `layout="sheet-right"`. */
const sheetVariants = {
  initial: { opacity: 0, x: '100%' },
  animate: { opacity: 1, x: 0, transition: { type: 'spring', damping: 28, stiffness: 320 } },
  exit: { opacity: 0, x: '100%', transition: { duration: 0.2 } },
} as const;

export interface DialogShellProps {
  open: boolean;
  /** Called on Escape, and on an overlay click when `dismissOnOverlayClick` is set. */
  onClose: () => void;
  /** z-index token from `@/lib/z-layers` — dialogs sit at different stacking layers. */
  zLayer: string;
  children: React.ReactNode;
  /** Portal to `document.body`. Default `true` — see file doc comment. */
  portal?: boolean;
  /** Clicking the backdrop calls `onClose`. Default `false` (Esc + explicit buttons only). */
  dismissOnOverlayClick?: boolean;
  /**
   * `center` (default) is a centered modal card. `sheet-right` is a full-height
   * panel that slides in from the right edge — the Settings panel's shape.
   * `fullscreen` is a near-edge-to-edge panel with a small margin — the file
   * preview's shape. The card's own width still comes from `panelClassName`.
   */
  layout?: 'center' | 'sheet-right' | 'fullscreen';
  role?: 'dialog' | 'alertdialog';
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  /** Classes for the card element itself — width/padding vary per dialog. */
  panelClassName?: string;
  /**
   * Run once per open, after the first paint, to place initial focus.
   * Receives the dialog element. If omitted, the focus trap's own default
   * "first focusable descendant" behavior applies.
   */
  onOpenFocus?: (dialog: HTMLDivElement) => void;
}

const DEFAULT_PANEL_CLASSNAME =
  'w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl';

export function DialogShell({
  open,
  onClose,
  zLayer,
  children,
  portal = true,
  dismissOnOverlayClick = false,
  layout = 'center',
  role = 'dialog',
  ariaLabelledBy,
  ariaDescribedBy,
  panelClassName = DEFAULT_PANEL_CLASSNAME,
  onOpenFocus,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Held in refs so the effect below depends only on `open`.
   *
   * Both callbacks are routinely passed as inline arrows — ConfirmDialog and
   * HostKeyDialog both do — so they get a fresh identity on every parent
   * render. With them in the dependency array the effect re-ran each time,
   * which meant: the focus trap was detached (restoring focus to whatever
   * opened the dialog) and reattached, and `onOpenFocus` fired again, yanking
   * focus back to Cancel/Reject. A user who had tabbed to "Delete" was silently
   * moved off it whenever the parent happened to re-render — and parents
   * re-render often, since several subscribe to the whole session Map.
   *
   * SettingsPanel already worked around exactly this for `onClose` with a ref
   * of its own; doing it here fixes it for every caller instead.
   */
  const onCloseRef = useRef(onClose);
  const onOpenFocusRef = useRef(onOpenFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
    onOpenFocusRef.current = onOpenFocus;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (onOpenFocusRef.current) {
      requestAnimationFrame(() => onOpenFocusRef.current?.(dialog));
    }

    return attachFocusTrap(dialog, { onEscape: () => onCloseRef.current() });
  }, [open]);

  const sheet = layout === 'sheet-right';
  const fullscreen = layout === 'fullscreen';

  const wrapperClassName = sheet
    ? `fixed inset-y-0 right-0 ${zLayer} flex`
    : fullscreen
      ? `fixed inset-2 ${zLayer} flex sm:inset-8`
      : `fixed inset-0 ${zLayer} flex items-center justify-center p-4`;
  const content = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            // A sheet's wrapper is only as wide as the panel, so an outside
            // click lands here rather than on the wrapper below. Centered
            // dialogs are fully covered by the wrapper and never reach this.
            onClick={dismissOnOverlayClick ? onClose : undefined}
            className={`fixed inset-0 ${zLayer} bg-black/60 backdrop-blur-sm`}
          />
          <motion.div
            key="panel"
            variants={sheet ? sheetVariants : dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={dismissOnOverlayClick ? onClose : undefined}
            className={wrapperClassName}
          >
            {/* Literal `role="dialog"` / `role="alertdialog"` (not a dynamic
                `role={role}`) so both Biome's a11y linter and the design-token
                guard (tests/unit/design-tokens.test.ts) can verify statically
                that every focus-trapping dialog declares its modal role. */}
            {/* onClick on the card below only stops propagation to the overlay's
                dismiss handler — it isn't a user-facing control, so it needs no
                keyboard equivalent. */}
            {role === 'alertdialog' ? (
              // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, see comment above
              <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                className={panelClassName}
                onClick={(e) => e.stopPropagation()}
              >
                {children}
              </div>
            ) : (
              // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, see comment above
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                className={panelClassName}
                onClick={(e) => e.stopPropagation()}
              >
                {children}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (!portal) return content;
  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
