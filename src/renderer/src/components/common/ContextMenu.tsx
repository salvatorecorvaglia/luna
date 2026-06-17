import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
}

export function ContextMenu({ items, children }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef(0);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Adjust position to stay within viewport
      const x = Math.min(e.clientX, window.innerWidth - 180);
      const y = Math.min(e.clientY, window.innerHeight - items.length * 32 - 8);
      focusIndexRef.current = 0;
      setPosition({ x, y });
    },
    [items.length],
  );

  const close = useCallback(() => setPosition(null), []);

  // Focus the first item every time the menu (re-)opens at a new position.
  useEffect(() => {
    if (!position) return;
    focusIndexRef.current = 0;
    const id = requestAnimationFrame(() => {
      const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [position]);

  // Keyboard + outside-click handlers. focusIndex is read via ref so the listener
  // doesn't tear down and re-focus the first item on every arrow press.
  useEffect(() => {
    if (!position) return;

    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }

      const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!menuItems || menuItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = (focusIndexRef.current + 1) % menuItems.length;
        focusIndexRef.current = next;
        menuItems[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = (focusIndexRef.current - 1 + menuItems.length) % menuItems.length;
        focusIndexRef.current = prev;
        menuItems[prev]?.focus();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [position, close]);

  return (
    <>
      {/** biome-ignore lint/a11y/noStaticElementInteractions: suppressed during migration */}
      <div onContextMenu={handleContextMenu}>{children}</div>
      <AnimatePresence>
        {position && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            role="menu"
            className={cn(
              'fixed min-w-[160px] rounded-lg border border-border/80 bg-card p-1 shadow-xl',
              Z.modal,
            )}
            style={{ left: position.x, top: position.y }}
          >
            {items.map((item, i) => (
              // Prefer the label as the stable key — context menus are short
              // lists with unique labels in practice. Array index is the
              // fallback for the rare unlabeled separator-only entry.
              <div key={item.label ? `${item.label}-${i}` : `sep-${i}`}>
                {/** biome-ignore lint/a11y/useFocusableInteractive: suppressed during migration */}
                {/** biome-ignore lint/a11y/useSemanticElements: suppressed during migration */}
                {/** biome-ignore lint/a11y/useAriaPropsForRole: suppressed during migration */}
                {item.separator && <div className="my-1 h-px bg-border/60" role="separator" />}
                {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
                <button
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    item.onClick();
                    close();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs cursor-pointer outline-none',
                    item.destructive
                      ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10'
                      : 'text-foreground hover:bg-accent focus-visible:bg-accent',
                  )}
                >
                  {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                  {item.label}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
