import { AnimatePresence, motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';

interface HelpTooltipProps {
  content: string;
  className?: string;
  iconClassName?: string;
}

export function HelpTooltip({ content, className, iconClassName }: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();

  return (
    <div
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <button
        type="button"
        // A plain hover-only icon is unreachable by keyboard; a focusable
        // button with focus/blur handlers gives Tab users the same reveal
        // mouse users get, and aria-describedby wires the content to it for
        // screen readers.
        className={cn(
          'flex cursor-help items-center justify-center rounded-full text-muted-foreground/30 transition-colors hover:text-muted-foreground/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          isVisible && 'text-muted-foreground/80',
        )}
        aria-describedby={isVisible ? tooltipId : undefined}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setIsVisible(false);
        }}
      >
        <HelpCircle className={cn('size-3', iconClassName)} />
      </button>
      <AnimatePresence>
        {isVisible && (
          <motion.div
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className={cn(
              'pointer-events-none absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 rounded-md border border-border/60 bg-popover p-2.5 shadow-xl backdrop-blur-md',
              Z.tooltipOverlay,
            )}
          >
            {/* Arrow */}
            <div className="absolute -bottom-[5px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-b border-r border-border/60 bg-popover" />

            <p className="relative z-10 text-[10px] leading-relaxed text-popover-foreground font-medium">
              {content}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
