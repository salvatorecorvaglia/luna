import { AlertTriangle } from 'lucide-react';
import { DialogShell } from '@/components/common/DialogShell';
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
  return (
    <DialogShell
      open={open}
      onClose={onCancel}
      zLayer={Z.confirm}
      ariaLabelledBy="confirm-dialog-title"
      ariaDescribedBy="confirm-dialog-message"
      onOpenFocus={(dialog) => dialog.querySelector<HTMLElement>('[data-cancel]')?.focus()}
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
        {/* "click to confirm" said nothing next to two buttons, and Enter does
            not confirm here — there is no key handler for it, unlike
            PromptDialog which is a real <form>. Describe only what is true. */}
        <span className="text-3xs uppercase tracking-wider text-muted-foreground/70">
          Esc to cancel
        </span>
        <div className="flex gap-2">
          {/* Outline cancel — not ghost — so the "safe" choice has
              visible weight when paired with a destructive action. */}

          <button type="button" data-cancel onClick={onCancel} className="btn-outline">
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={destructive ? 'btn-destructive' : 'btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
