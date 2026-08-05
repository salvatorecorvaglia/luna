import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

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

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape — uses the shared util so the trap logic (including
  // contenteditable/textarea/select coverage and trigger-focus restoration)
  // matches the rest of the app's dialogs.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    requestAnimationFrame(() => {
      const cancelBtn = dialog.querySelector<HTMLElement>('[data-cancel]');
      cancelBtn?.focus();
    });

    return attachFocusTrap(dialog, { onEscape: onCancel });
  }, [open, onCancel]);

  // Portal to <body> so the dialog is decoupled from any parent that may
  // unmount (e.g. ConnectionForm closing). Without the portal the discard-
  // warning could vanish silently mid-confirm if its parent dropped.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.confirm} bg-black/60 backdrop-blur-sm`}
          />
          <motion.div
            key="panel"
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.confirm} flex items-center justify-center p-4`}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-message"
              className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                {destructive && (
                  <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <AlertTriangle className="size-4.5 text-destructive-fg" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 id="confirm-dialog-title" className="text-sm font-semibold text-foreground">
                    {title}
                  </h3>
                  <p
                    id="confirm-dialog-message"
                    className="mt-1 text-xs text-muted-foreground leading-relaxed"
                  >
                    {message}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Esc to cancel · click to confirm
                </span>
                <div className="flex gap-2">
                  {/* Outline cancel — not ghost — so the "safe" choice has
                      visible weight when paired with a destructive action. */}

                  <button data-cancel onClick={onCancel} className="btn-outline">
                    {cancelLabel}
                  </button>

                  <button
                    onClick={onConfirm}
                    className={destructive ? 'btn-destructive' : 'btn-primary'}
                  >
                    {confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
