import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<IconButtonSize, string> = {
  // Hit area is enforced to 2rem min in .btn-icon; inline padding here just
  // controls the visual padding around the icon glyph.
  sm: '!p-1',
  md: '!p-1.5',
  lg: '!p-2',
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  /** Required: icon-only buttons must announce their purpose. */
  'aria-label': string;
  icon: ReactNode;
}

/**
 * Icon-only button. Enforces `aria-label` at the type level so we can't
 * ship another silent toolbar control. Padding sizes are constrained so
 * hit-area drift (the prior `!p-0.5` / `!p-1` / `!p-2` zoo) can't recur.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'sm', icon, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={cn('btn-icon', SIZE_CLASS[size], className)}
      {...rest}
    >
      {icon}
    </button>
  );
});
