import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** Layout density. `compact` is for inline strips (transfer queue, drop zones). */
  density?: 'default' | 'compact';
}

/**
 * Single empty-state primitive. Use anywhere a list/panel has nothing to
 * show but the surface still needs to be discoverable.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  density = 'default',
}: EmptyStateProps) {
  const compact = density === 'compact';
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center text-center text-muted-foreground',
        compact ? 'gap-1 px-3 py-3' : 'gap-2 p-6',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'text-muted-foreground/60',
            compact ? '[&>svg]:h-4 [&>svg]:w-4' : '[&>svg]:h-8 [&>svg]:w-8',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <span className={cn('font-medium text-foreground/80', compact ? 'text-[11px]' : 'text-xs')}>
        {title}
      </span>
      {description && (
        <span
          className={cn(
            'text-muted-foreground/70',
            compact ? 'text-[10px]' : 'text-[11px] leading-relaxed max-w-xs',
          )}
        >
          {description}
        </span>
      )}
      {action && <div className={cn(compact ? 'mt-1' : 'mt-2')}>{action}</div>}
    </div>
  );
}
