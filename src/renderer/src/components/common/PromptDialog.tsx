import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';

interface PromptDialogProps {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
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

export function PromptDialog({
  open,
  title,
  message,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset value when dialog opens. Setting state in an effect is intentional
  // here: the dialog mounts with a stale `defaultValue` and we want to refresh
  // it whenever it transitions to open. The alternative (lifting state) leaks
  // dialog concerns to every caller.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, defaultValue]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachFocusTrap(dialog, { onEscape: onCancel });
  }, [open, onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.modal} bg-black/60 backdrop-blur-sm`}
          />
          <motion.div
            key="panel"
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            // The overlay above is fully covered by this inset-0 panel, so a
            // click-to-dismiss handler has to live here (where clicks actually
            // land) rather than on the now-unreachable overlay div — the
            // inner card's stopPropagation only makes sense paired with this.
            onClick={onCancel}
            className={`fixed inset-0 ${Z.modal} flex items-center justify-center p-4`}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="prompt-dialog-title"
              aria-describedby={message ? 'prompt-dialog-message' : undefined}
              className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="prompt-dialog-title" className="text-sm font-semibold text-foreground">
                {title}
              </h3>
              {message && (
                <p
                  id="prompt-dialog-message"
                  className="mt-1 text-xs text-muted-foreground leading-relaxed"
                >
                  {message}
                </p>
              )}
              <form onSubmit={handleSubmit}>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  // Strip leading whitespace as the user types so the
                  // disabled-state of the submit button matches the value
                  // that would actually be submitted.
                  onChange={(e) => setValue(e.target.value.replace(/^\s+/, ''))}
                  placeholder={placeholder}
                  className="form-input mt-3"
                />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    Enter to confirm · Esc to cancel
                  </span>
                  <div className="flex gap-2">
                    <button type="button" onClick={onCancel} className="btn-outline">
                      {cancelLabel}
                    </button>
                    <button type="submit" disabled={!value.trim()} className="btn-primary">
                      {confirmLabel}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
