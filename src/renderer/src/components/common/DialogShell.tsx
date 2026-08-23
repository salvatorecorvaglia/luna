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
  role = 'dialog',
  ariaLabelledBy,
  ariaDescribedBy,
  panelClassName = DEFAULT_PANEL_CLASSNAME,
  onOpenFocus,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (onOpenFocus) {
      requestAnimationFrame(() => onOpenFocus(dialog));
    }

    return attachFocusTrap(dialog, { onEscape: onClose });
  }, [open, onClose, onOpenFocus]);

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
            className={`fixed inset-0 ${zLayer} bg-black/60 backdrop-blur-sm`}
          />
          <motion.div
            key="panel"
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={dismissOnOverlayClick ? onClose : undefined}
            className={`fixed inset-0 ${zLayer} flex items-center justify-center p-4`}
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
