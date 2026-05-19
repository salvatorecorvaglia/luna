import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HelpTooltipProps {
  content: string;
  className?: string;
  iconClassName?: string;
}

export function HelpTooltip({ content, className, iconClassName }: HelpTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <HelpCircle
        className={cn(
          'size-3 cursor-help text-muted-foreground/30 transition-colors hover:text-muted-foreground/60',
          isVisible && 'text-muted-foreground/80',
          iconClassName,
        )}
      />
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, scale: 0.95 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            className="absolute bottom-full left-1/2 z-[100] mb-2 w-52 -translate-x-1/2 rounded-md border border-border/60 bg-popover p-2.5 shadow-xl backdrop-blur-md"
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
