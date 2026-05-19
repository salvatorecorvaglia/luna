import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<SpinnerSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
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
