import { toastArgs } from '@shared/error-messages';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  Keyboard,
  Monitor,
  Palette,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConnections } from '@/hooks/use-connections';
import { attachFocusTrap } from '@/lib/focus-trap';
import { isMac } from '@/lib/platform';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
import { useConnectionStore } from '@/stores/connection-store';
import { useStorageStore } from '@/stores/storage-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  keywords?: string[];
  shortcut?: string[];
  /**
   * Keep the palette mounted after running the action.
   *
   * `App` renders the palette conditionally (`{commandPaletteOpen && <CommandPalette/>}`),
   * so closing it unmounts this component — and with it any dialog it owns. A
   * command whose action only opens a nested dialog would set the flag, unmount
   * in the same batch, and appear to do nothing at all.
   */
  keepOpen?: boolean;
}

const MOD = isMac ? '⌘' : 'Ctrl';

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, y: -10, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.1 } },
} as const;

export function CommandPalette() {
  // Individual selectors rather than whole-store subscriptions. The
  // `useTerminalStore()` one in particular re-rendered the entire palette on
  // every session status tick, and the command list is rebuilt from these on
  // each render.
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setShortcutsHelpOpen = useUIStore((s) => s.setShortcutsHelpOpen);
  const setTerminalTheme = useTerminalStore((s) => s.setTerminalTheme);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const tabOrder = useTerminalStore((s) => s.tabOrder);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const openCreateForm = useConnectionStore((s) => s.openCreateForm);
  const toggleHiddenFiles = useStorageStore((s) => s.toggleHiddenFiles);
  const showHiddenFiles = useStorageStore((s) => s.showHiddenFiles);
  const { data: connections = [] } = useConnections();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Capture the element that owned focus before the palette opened so we
  // can return focus there on close (important for keyboard-only users).
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Reset the search box and selection whenever the palette opens. Run this
  // as an effect rather than a render-phase setState (the prevState pattern)
  // so React 18's concurrent mode doesn't double-fire it under strict-mode
  // remount.
  useEffect(() => {
    if (commandPaletteOpen) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Resetting query/selection when the palette toggles open is exactly
      // the "synchronize React state with an external trigger" case that
      // useEffect is for; the lint rule's general guidance doesn't fit.
      setQuery('');
      setSelectedIndex(0);
    } else if (previouslyFocusedRef.current) {
      const el = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // Defer to next tick so the palette's unmount has finished before we
      // try to restore focus — restoring synchronously can lose to focus
      // changes triggered by the close itself.
      queueMicrotask(() => el.focus?.());
    }
  }, [commandPaletteOpen]);

  // Static commands that depend only on store actions/flags. Splitting these
  // out of the connection-derived list means the (potentially long) per-
  // connection commands aren't rebuilt on every keystroke into the search
  // box — only when the relevant slice actually changes.
  const staticCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [
      {
        id: 'new-connection',
        label: 'New Connection',
        description: 'Create a new SSH connection',
        icon: <Plus className="size-4" aria-hidden="true" />,
        category: 'Connections',
        action: () => openCreateForm(),
        keywords: ['add', 'create', 'ssh'],
        shortcut: [MOD, 'N'],
      },
      {
        id: 'delete-all-connections',
        label: 'Delete All Connections',
        description: 'Permanently remove all connections and credentials',
        icon: <Trash2 className="size-4" aria-hidden="true" />,
        category: 'Connections',
        action: () => setConfirmDeleteAll(true),
        keywords: ['purge', 'clear', 'reset', 'delete'],
        // Opens the ConfirmDialog owned by this component — see `keepOpen`.
        keepOpen: true,
      },
      {
        id: 'view-local',
        label: 'Switch to Local Terminal',
        icon: <Monitor className="size-4" aria-hidden="true" />,
        category: 'Views',
        action: () => setActiveView('local'),
        keywords: ['terminal', 'local', 'view'],
        shortcut: [MOD, '⇧', '1'],
      },
      {
        id: 'view-terminal',
        label: 'Switch to SSH Terminal',
        icon: <Terminal className="size-4" aria-hidden="true" />,
        category: 'Views',
        action: () => setActiveView('terminal'),
        keywords: ['ssh', 'tab', 'view'],
        shortcut: [MOD, '⇧', '2'],
      },
      {
        id: 'view-sftp',
        label: 'Switch to SFTP',
        icon: <FolderOpen className="size-4" aria-hidden="true" />,
        category: 'Views',
        action: () => setActiveView('sftp'),
        keywords: ['files', 'browse', 'view'],
        shortcut: [MOD, '⇧', '3'],
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        icon: <PanelLeft className="size-4" aria-hidden="true" />,
        category: 'Interface',
        action: toggleSidebar,
        keywords: ['panel', 'hide', 'show'],
        shortcut: [MOD, 'B'],
      },
      {
        id: 'theme-dracula',
        label: 'Terminal Theme: Dracula',
        icon: <Palette className="size-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('dracula'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'theme-nord',
        label: 'Terminal Theme: Nord',
        icon: <Palette className="size-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('nord'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'theme-tokyo-night',
        label: 'Terminal Theme: Tokyo Night',
        icon: <Palette className="size-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('tokyo-night'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'settings',
        label: 'Open Settings',
        icon: <Settings className="size-4" aria-hidden="true" />,
        category: 'Interface',
        action: () => setSettingsOpen(true),
        keywords: ['preferences', 'config'],
        shortcut: [MOD, ','],
      },
      {
        id: 'keyboard-shortcuts',
        label: 'Keyboard Shortcuts',
        icon: <Keyboard className="size-4" aria-hidden="true" />,
        category: 'Interface',
        action: () => setShortcutsHelpOpen(true),
        keywords: ['help', 'keys', 'shortcuts'],
        shortcut: ['?'],
      },
      {
        id: 'sftp-toggle-hidden',
        label: showHiddenFiles ? 'Hide Hidden Files' : 'Show Hidden Files',
        icon: showHiddenFiles ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        ),
        category: 'Storage',
        action: () => {
          setActiveView('sftp');
          toggleHiddenFiles();
        },
        keywords: ['dotfiles', 'hidden'],
      },
      {
        id: 'sftp-refresh',
        label: 'Refresh File Browser',
        icon: <RefreshCw className="size-4" aria-hidden="true" />,
        category: 'Storage',
        action: () => {
          setActiveView('sftp');
          // FilePane re-fetches via useSftp hook keyed by path; nudge by re-setting same path
          const { remotePath, setRemotePath, localPath, setLocalPath } = useStorageStore.getState();
          setRemotePath(remotePath);
          setLocalPath(localPath);
        },
        keywords: ['reload', 'sftp'],
      },
    ];

    if (activeSessionId && tabOrder.length > 0) {
      const idx = tabOrder.indexOf(activeSessionId);
      // Non-null: `% tabOrder.length` always yields a valid index since
      // tabOrder.length > 0 is guaranteed by the outer condition.
      const next = tabOrder[(idx + 1) % tabOrder.length]!;
      const prev = tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length]!;
      cmds.push(
        {
          id: 'terminal-close-tab',
          label: 'Close Active Terminal Tab',
          icon: <X className="size-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => closeTab(activeSessionId),
          keywords: ['close', 'tab', 'kill'],
          shortcut: [MOD, 'W'],
        },
        {
          id: 'terminal-next-tab',
          label: 'Next Terminal Tab',
          icon: <ChevronRight className="size-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => setActiveSession(next),
          shortcut: [MOD, '⇧', ']'],
        },
        {
          id: 'terminal-prev-tab',
          label: 'Previous Terminal Tab',
          icon: <ChevronLeft className="size-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => setActiveSession(prev),
          shortcut: [MOD, '⇧', '['],
        },
      );
    }

    return cmds;
  }, [
    openCreateForm,
    setActiveView,
    toggleSidebar,
    setSettingsOpen,
    setTerminalTheme,
    toggleHiddenFiles,
    showHiddenFiles,
    activeSessionId,
    tabOrder,
    setActiveSession,
    closeTab,
    setShortcutsHelpOpen,
  ]);

  const connectionCommands: Command[] = useMemo(
    () =>
      connections.map((conn) => ({
        id: `connect-${conn.id}`,
        label: `Connect: ${conn.name}`,
        description: `${conn.username}@${conn.host}:${conn.port}`,
        icon: <Server className="size-4" aria-hidden="true" />,
        category: 'Connections',
        action: () => {
          setActiveView('terminal');
          void connectToHost(conn.id);
        },
        keywords: ['ssh', conn.host, conn.username],
      })),
    [connections, setActiveView],
  );

  const commands = useMemo(
    () => [...staticCommands, ...connectionCommands],
    [staticCommands, connectionCommands],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;

    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.keywords?.some((k) => k.includes(q)),
    );
  }, [commands, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Command[]>();
    for (const cmd of filtered) {
      const list = groups.get(cmd.category) || [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return groups;
  }, [filtered]);

  /**
   * The rendered order, flattened.
   *
   * `selectedIndex` used to be resolved against two different arrays: rows were
   * highlighted by their *grouped* position, while Enter and
   * `aria-activedescendant` read `filtered` — which is
   * `[...staticCommands, ...connectionCommands]`, i.e. categories interleaved.
   * The two orderings agree only by accident, so the palette routinely
   * highlighted one command and ran a different one. Deriving the flat list
   * from `grouped` makes the rendered order the only order.
   */
  const ordered = useMemo(() => Array.from(grouped.values()).flat(), [grouped]);

  // Index per command id, for the rows. Same array as keyboard navigation uses.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    ordered.forEach((cmd, idx) => {
      map.set(cmd.id, idx);
    });
    return map;
  }, [ordered]);

  // Reset selection to the top whenever the search query changes so the
  // first result is always the active one.

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Real focus trap, as used by every other dialog in the app (DialogShell
  // routes through the same helper). Escape is already handled by the input's
  // onKeyDown, so only the Tab cycle is delegated here.
  useEffect(() => {
    if (!commandPaletteOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    return attachFocusTrap(panel);
  }, [commandPaletteOpen]);

  // Scroll selected item into view

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const activeOption = ordered[selectedIndex];
  const activeOptionId = activeOption ? `command-option-${activeOption.id}` : undefined;

  const executeCommand = (cmd: Command) => {
    cmd.action();
    if (!cmd.keepOpen) setCommandPaletteOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = ordered[selectedIndex];
      if (cmd) executeCommand(cmd);
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
    // Tab is deliberately not handled here any more — attachFocusTrap below
    // owns it. Swallowing Tab on the input alone was not a trap: it only
    // covered the input, so tabbing from the close button escaped straight
    // into the background while the palette stayed modal on screen.
  };

  return (
    <>
      <AnimatePresence>
        {commandPaletteOpen && (
          <>
            <motion.div
              key="overlay"
              variants={overlayVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={() => setCommandPaletteOpen(false)}
              className={cn('fixed inset-0 bg-black/50 backdrop-blur-sm', Z.modal)}
            />
            {/* Now that this traps focus it is a modal in fact, so it has to
                say so — otherwise a screen reader user is trapped in a region
                that was never announced. (tests/unit/design-tokens.test.ts
                enforces this for every focus-trapping dialog.) The combobox
                input inside keeps its own listbox semantics. */}
            <motion.div
              key="panel"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              variants={dialogVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className={cn(
                'no-drag fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2',
                Z.modal,
              )}
            >
              <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl">
                {/* Search input */}
                <div className="flex items-center border-b border-border/60 px-3 rounded-t-xl">
                  <Search className="size-4 text-muted-foreground/60 flex-shrink-0" tabIndex={-1} />
                  <input
                    type="text"
                    placeholder="Type a command..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 border-none bg-transparent py-3 pl-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 !outline-none !ring-0 focus:!outline-none focus:!ring-0 focus:!shadow-none focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!shadow-none rounded-lg transition-all duration-200"
                    autoFocus
                    role="combobox"
                    aria-expanded={commandPaletteOpen}
                    aria-controls="command-palette-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={activeOptionId}
                  />

                  <button
                    type="button"
                    onClick={() => setCommandPaletteOpen(false)}
                    className="btn-icon !p-1.5 ml-1"
                    aria-label="Close command palette"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {/* Results */}
                <div
                  ref={listRef}
                  id="command-palette-listbox"
                  role="listbox"
                  aria-label="Commands"
                  className="max-h-[300px] overflow-y-auto p-1.5"
                >
                  {ordered.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground/60">
                      No commands found
                    </div>
                  ) : (
                    Array.from(grouped.entries()).map(([category, cmds]) => (
                      <div key={category} role="group" aria-label={category}>
                        <div className="px-2 pb-1 pt-2 text-3xs font-bold uppercase tracking-widest text-muted-foreground/50">
                          {category}
                        </div>
                        {cmds.map((cmd) => {
                          const index = indexById.get(cmd.id) ?? 0;
                          const isSelected = index === selectedIndex;
                          return (
                            // biome-ignore lint/a11y/useKeyWithClickEvents: combobox option — keyboard handled by the input's onKeyDown, not per-row
                            <div
                              key={cmd.id}
                              id={`command-option-${cmd.id}`}
                              role="option"
                              aria-selected={isSelected}
                              data-selected={isSelected}
                              onClick={() => executeCommand(cmd)}
                              onMouseEnter={() => setSelectedIndex(index)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm cursor-pointer',
                                isSelected ? 'bg-accent text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              <div
                                aria-hidden="true"
                                className={cn(
                                  'flex-shrink-0',
                                  isSelected ? 'text-foreground' : 'text-muted-foreground/60',
                                )}
                              >
                                {cmd.icon}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm-plus">{cmd.label}</div>
                                {cmd.description && (
                                  <div className="truncate text-2xs text-muted-foreground/60">
                                    {cmd.description}
                                  </div>
                                )}
                              </div>
                              {cmd.shortcut && (
                                <div className="flex flex-shrink-0 items-center gap-0.5">
                                  {cmd.shortcut.map((key) => (
                                    <kbd
                                      key={key}
                                      className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-3xs text-muted-foreground"
                                    >
                                      {key}
                                    </kbd>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 text-2xs text-muted-foreground/50 rounded-b-xl">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-3xs">
                        ↑↓
                      </kbd>
                      navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-3xs">
                        ↵
                      </kbd>
                      select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-3xs">
                        esc
                      </kbd>
                      close
                    </span>
                  </div>
                  <span>{ordered.length} commands</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={confirmDeleteAll}
        title="Delete all connections?"
        message="This will permanently delete all your saved connections and credentials. This action cannot be undone."
        confirmLabel="Delete All"
        destructive
        onConfirm={async () => {
          try {
            await getApi().connections.deleteAll();
            void queryClient.invalidateQueries({ queryKey: ['connections'] });
            toast.success('All connections deleted');
            setConfirmDeleteAll(false);
            setCommandPaletteOpen(false);
          } catch (err: unknown) {
            toast.error(...toastArgs(err, 'Failed to delete connections'));
          }
        }}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </>
  );
}
