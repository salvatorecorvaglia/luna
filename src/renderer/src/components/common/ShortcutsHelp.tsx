import { Keyboard, X } from 'lucide-react';
import { useCallback } from 'react';
import { DialogShell } from '@/components/common/DialogShell';
import { IconButton } from '@/components/ui';
import { MOD_KEY } from '@/lib/platform';
import { Z } from '@/lib/z-layers';
import { useUIStore } from '@/stores/ui-store';

interface ShortcutRowProps {
  label: string;
  keys: string[];
}

function ShortcutRow({ label, keys }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm-plus text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd
            key={i}
            className="flex min-w-[20px] items-center justify-center rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-2xs font-medium text-foreground shadow-sm"
          >
            {key === 'MOD' ? MOD_KEY : key}
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
      // "Refresh (SFTP/S3) — R" used to be listed here with no handler behind
      // it anywhere in the renderer. Removed rather than implemented: a bare
      // printable key is a poor global shortcut in an app full of text fields
      // and live terminals. Both file panes already have a refresh control.
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

  // Memoised: DialogShell re-attaches its focus trap whenever `onClose`
  // changes identity.
  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  return (
    <DialogShell
      open={isOpen}
      onClose={handleClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="shortcuts-help-title"
      panelClassName="w-full max-w-2xl overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Keyboard className="size-4" />
          </div>
          <div>
            <h2 id="shortcuts-help-title" className="text-base font-semibold text-foreground">
              Keyboard Shortcuts
            </h2>
            <p className="text-2xs text-muted-foreground">Speed up your workflow</p>
          </div>
        </div>

        <IconButton
          size="lg"
          onClick={handleClose}
          aria-label="Close"
          icon={<X className="size-4" />}
        />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-x-12 gap-y-8 p-8">
        {CATEGORIES.map((cat) => (
          <div key={cat.title}>
            <h3 className="mb-3 text-3xs font-bold uppercase tracking-widest text-primary/70">
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
        <div className="flex items-center gap-2 text-2xs text-muted-foreground/60">
          <div className="size-1.5 rounded-full bg-primary/40" />
          <span>
            Press{' '}
            <kbd className="mx-1 rounded border border-border/40 bg-muted/40 px-1 font-mono text-3xs font-medium text-foreground">
              ?
            </kbd>{' '}
            at any time to open this help panel.
          </span>
        </div>
      </div>
    </DialogShell>
  );
}
