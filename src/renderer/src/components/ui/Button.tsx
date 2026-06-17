import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'destructive';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  destructive: 'btn-destructive',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

/**
 * Wraps the .btn-* CSS classes from main.css and standardizes the loading
 * affordance: a spinner appears next to the label and `aria-busy` is set;
 * the label text never changes (no "Saving…" swaps), so layout doesn't shift
 * and the button width stays stable.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, leadingIcon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(VARIANT_CLASS[variant], className)}
      {...rest}
    >
      {loading ? <Spinner size="xs" /> : leadingIcon}
      {children}
    </button>
  );
});
