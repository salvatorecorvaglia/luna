import { useId } from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps {
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * Shared switch primitive. Replaces the inline ToggleRow in SettingsPanel so
 * the on-state color and knob geometry can't drift per surface.
 */
export function Toggle({ label, enabled, onToggle, disabled = false }: ToggleProps) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between py-1">
      <span id={labelId} className={cn('text-xs text-muted-foreground', disabled && 'opacity-60')}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => !disabled && onToggle(!enabled)}
        className={cn(
          'flex h-5 w-9 items-center rounded-full px-0.5 transition-colors',
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
