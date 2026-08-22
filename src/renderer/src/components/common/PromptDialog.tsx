import { useEffect, useRef, useState } from 'react';
import { DialogShell } from '@/components/common/DialogShell';
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onCancel}
      zLayer={Z.modal}
      portal={false}
      dismissOnOverlayClick
      ariaLabelledBy="prompt-dialog-title"
      ariaDescribedBy={message ? 'prompt-dialog-message' : undefined}
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
          // Strip leading whitespace as the user types so the disabled-state
          // of the submit button matches the value that would actually be
          // submitted.
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
    </DialogShell>
  );
}
