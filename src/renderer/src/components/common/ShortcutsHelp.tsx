import { AnimatePresence, motion } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

interface ShortcutRowProps {
  label: string;
  keys: string[];
}

function ShortcutRow({ label, keys }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="flex min-w-[20px] items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-sm"
          >
            {key === 'MOD' ? MOD : key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

const CATEGORIES = [
  {
    title: 'General',
    shortcuts: [
      { label: 'Command Palette', keys: ['MOD', 'K'] },
      { label: 'Settings', keys: ['MOD', ','] },
      { label: 'Toggle Sidebar', keys: ['MOD', 'B'] },
      { label: 'Keyboard Shortcuts', keys: ['?'] },
    ],
  },
  {
    title: 'Views',
    shortcuts: [
      { label: 'Local Terminal', keys: ['MOD', '⇧', '1'] },
      { label: 'SSH Terminal', keys: ['MOD', '⇧', '2'] },
      { label: 'Storage / SFTP', keys: ['MOD', '⇧', '3'] },
    ],
  },
  {
    title: 'Connections',
    shortcuts: [
      { label: 'New Connection', keys: ['MOD', 'N'] },
      { label: 'Refresh (SFTP/S3)', keys: ['R'] },
    ],
  },
  {
    title: 'Terminal',
    shortcuts: [
      { label: 'New Tab', keys: ['MOD', 'T'] },
      { label: 'Close Tab', keys: ['MOD', 'W'] },
      { label: 'Next Tab', keys: ['MOD', '⇧', ']'] },
      { label: 'Previous Tab', keys: ['MOD', '⇧', '['] },
    ],
  },
];

export function ShortcutsHelp() {
  const isOpen = useUIStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUIStore((s) => s.setShortcutsHelpOpen);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-[70] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 p-4"
          >
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-2xl backdrop-blur-xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/40 px-6 py-4 bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Keyboard className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Keyboard Shortcuts</h2>
                    <p className="text-[11px] text-muted-foreground">Speed up your workflow</p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 gap-x-12 gap-y-8 p-8">
                {CATEGORIES.map((cat) => (
                  <div key={cat.title}>
                    <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-primary/70">
                      {cat.title}
                    </h3>
                    <div className="divide-y divide-border/20">
                      {cat.shortcuts.map((s) => (
                        <ShortcutRow key={s.label} label={s.label} keys={s.keys} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="bg-muted/10 border-t border-border/40 px-8 py-4">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                  <div className="size-1.5 rounded-full bg-primary/40" />
                  <span>
                    Press{' '}
                    <kbd className="mx-1 rounded border border-border/40 bg-muted/40 px-1 font-mono text-[10px] font-medium text-foreground">
                      ?
                    </kbd>{' '}
                    at any time to open this help panel.
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
