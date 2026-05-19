import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}

export function Spinner({ size = 'sm', className, label }: SpinnerProps) {
  return (
    <Loader2
      className={cn('animate-spin', SIZE_CLASS[size], className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
