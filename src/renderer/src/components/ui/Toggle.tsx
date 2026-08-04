import { useId } from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps {
  label: string;
  /**
   * Optional explanatory line under the label. Use it whenever flipping the
   * switch has a consequence the label alone can't convey — security-relevant
   * toggles in particular should never be a bare noun phrase.
   */
  description?: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * Shared switch primitive. Replaces the inline ToggleRow in SettingsPanel so
 * the on-state color and knob geometry can't drift per surface.
 */
export function Toggle({ label, description, enabled, onToggle, disabled = false }: ToggleProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <span
          id={labelId}
          className={cn('block text-xs text-muted-foreground', disabled && 'opacity-60')}
        >
          {label}
        </span>
        {description && (
          <span
            id={descriptionId}
            className={cn(
              'mt-0.5 block text-[11px] leading-snug text-muted-foreground/70',
              disabled && 'opacity-60',
            )}
          >
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => !disabled && onToggle(!enabled)}
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors',
          enabled ? 'bg-brand-emerald' : 'bg-muted',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        <div
          className={cn(
            'size-4 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}
