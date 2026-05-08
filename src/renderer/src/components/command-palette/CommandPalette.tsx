import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderOpen,
  Palette,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnectionStore } from '@/stores/connection-store';
import { useSftpStore } from '@/stores/sftp-store';
import { useConnections } from '@/hooks/use-connections';
import { connectToHost } from '@/lib/ssh';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
  keywords?: string[];
  shortcut?: string[];
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
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
};

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveView,
    toggleSidebar,
    setSettingsOpen,
  } = useUIStore();
  const { setTerminalTheme, activeTabId, tabOrder, setActiveTab, closeTab } = useTerminalStore();
  const { openCreateForm } = useConnectionStore();
  const { toggleHiddenFiles, showHiddenFiles } = useSftpStore();
  const { data: connections = [] } = useConnections();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
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
      /* eslint-disable react-hooks/set-state-in-effect */
      setQuery('');
      setSelectedIndex(0);
      /* eslint-enable react-hooks/set-state-in-effect */
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
        icon: <Plus className="h-4 w-4" aria-hidden="true" />,
        category: 'Connections',
        action: () => openCreateForm(),
        keywords: ['add', 'create', 'ssh'],
        shortcut: [MOD, 'N'],
      },
      {
        id: 'view-terminal',
        label: 'Switch to Terminal',
        icon: <Terminal className="h-4 w-4" aria-hidden="true" />,
        category: 'Views',
        action: () => setActiveView('terminal'),
        keywords: ['tab', 'view'],
      },
      {
        id: 'view-sftp',
        label: 'Switch to SFTP',
        icon: <FolderOpen className="h-4 w-4" aria-hidden="true" />,
        category: 'Views',
        action: () => setActiveView('sftp'),
        keywords: ['files', 'browse', 'view'],
      },
      {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        icon: <PanelLeft className="h-4 w-4" aria-hidden="true" />,
        category: 'Interface',
        action: toggleSidebar,
        keywords: ['panel', 'hide', 'show'],
        shortcut: [MOD, 'B'],
      },
      {
        id: 'theme-dracula',
        label: 'Terminal Theme: Dracula',
        icon: <Palette className="h-4 w-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('dracula'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'theme-nord',
        label: 'Terminal Theme: Nord',
        icon: <Palette className="h-4 w-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('nord'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'theme-tokyo-night',
        label: 'Terminal Theme: Tokyo Night',
        icon: <Palette className="h-4 w-4" />,
        category: 'Terminal',
        action: () => setTerminalTheme('tokyo-night'),
        keywords: ['theme', 'color'],
      },
      {
        id: 'settings',
        label: 'Open Settings',
        icon: <Settings className="h-4 w-4" aria-hidden="true" />,
        category: 'Interface',
        action: () => setSettingsOpen(true),
        keywords: ['preferences', 'config'],
        shortcut: [MOD, ','],
      },
      {
        id: 'sftp-toggle-hidden',
        label: showHiddenFiles ? 'Hide Hidden Files' : 'Show Hidden Files',
        icon: showHiddenFiles ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        ),
        category: 'SFTP',
        action: () => {
          setActiveView('sftp');
          toggleHiddenFiles();
        },
        keywords: ['dotfiles', 'hidden'],
      },
      {
        id: 'sftp-refresh',
        label: 'Refresh File Browser',
        icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
        category: 'SFTP',
        action: () => {
          setActiveView('sftp');
          // FilePane re-fetches via useSftp hook keyed by path; nudge by re-setting same path
          const { remotePath, setRemotePath, localPath, setLocalPath } = useSftpStore.getState();
          setRemotePath(remotePath);
          setLocalPath(localPath);
        },
        keywords: ['reload', 'sftp'],
      },
    ];

    if (activeTabId && tabOrder.length > 0) {
      const idx = tabOrder.indexOf(activeTabId);
      const next = tabOrder[(idx + 1) % tabOrder.length];
      const prev = tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length];
      cmds.push(
        {
          id: 'terminal-close-tab',
          label: 'Close Active Terminal Tab',
          icon: <X className="h-4 w-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => closeTab(activeTabId),
          keywords: ['close', 'tab', 'kill'],
          shortcut: [MOD, 'W'],
        },
        {
          id: 'terminal-next-tab',
          label: 'Next Terminal Tab',
          icon: <ChevronRight className="h-4 w-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => setActiveTab(next),
          shortcut: [MOD, '⇧', ']'],
        },
        {
          id: 'terminal-prev-tab',
          label: 'Previous Terminal Tab',
          icon: <ChevronLeft className="h-4 w-4" aria-hidden="true" />,
          category: 'Terminal',
          action: () => setActiveTab(prev),
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
    activeTabId,
    tabOrder,
    setActiveTab,
    closeTab,
  ]);

  const connectionCommands: Command[] = useMemo(
    () =>
      connections.map((conn) => ({
        id: `connect-${conn.id}`,
        label: `Connect: ${conn.name}`,
        description: `${conn.username}@${conn.host}:${conn.port}`,
        icon: <Server className="h-4 w-4" aria-hidden="true" />,
        category: 'Connections',
        action: () => {
          setActiveView('terminal');
          connectToHost(conn.id);
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

  // Precompute flat index per command ID so we avoid a mutable counter during render.
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const [, cmds] of grouped) {
      for (const cmd of cmds) {
        map.set(cmd.id, idx++);
      }
    }
    return map;
  }, [grouped]);

  // Reset selection to the top whenever the search query changes so the
  // first result is always the active one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const executeCommand = (cmd: Command) => {
    cmd.action();
    setCommandPaletteOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        executeCommand(filtered[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    } else if (e.key === 'Tab') {
      // Keep focus inside the palette — Arrow keys handle navigation, Tab would
      // otherwise escape into the background and lose modal context.
      e.preventDefault();
    }
  };

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="no-drag fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl">
              {/* Search input */}
              <div className="flex items-center border-b border-border/60 px-3 rounded-t-xl">
                <Search className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" tabIndex={-1} />
                <input
                  type="text"
                  placeholder="Type a command..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 border-none bg-transparent py-3 pl-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 !outline-none !ring-0 focus:!outline-none focus:!ring-0 focus:!shadow-none focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!shadow-none rounded-lg transition-all duration-200"
                  autoFocus
                />
                <button
                  onClick={() => setCommandPaletteOpen(false)}
                  className="btn-icon !p-1.5 ml-1"
                  aria-label="Close command palette"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1.5">
                {filtered.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground/60">
                    No commands found
                  </div>
                ) : (
                  Array.from(grouped.entries()).map(([category, cmds]) => (
                    <div key={category}>
                      <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                        {category}
                      </div>
                      {cmds.map((cmd) => {
                        const index = flatIndexMap.get(cmd.id) ?? 0;
                        const isSelected = index === selectedIndex;
                        return (
                          <button
                            key={cmd.id}
                            data-selected={isSelected}
                            onClick={() => executeCommand(cmd)}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm cursor-pointer',
                              isSelected ? 'bg-accent text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            <div
                              className={cn(
                                'flex-shrink-0',
                                isSelected ? 'text-foreground' : 'text-muted-foreground/60',
                              )}
                            >
                              {cmd.icon}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px]">{cmd.label}</div>
                              {cmd.description && (
                                <div className="truncate text-[11px] text-muted-foreground/60">
                                  {cmd.description}
                                </div>
                              )}
                            </div>
                            {cmd.shortcut && (
                              <div className="flex flex-shrink-0 items-center gap-0.5">
                                {cmd.shortcut.map((key) => (
                                  <kbd
                                    key={key}
                                    className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-[10px] text-muted-foreground"
                                  >
                                    {key}
                                  </kbd>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground/50 rounded-b-xl">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-[10px]">
                      ↑↓
                    </kbd>
                    navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-[10px]">
                      ↵
                    </kbd>
                    select
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded border border-border/60 bg-muted/50 px-1 py-px font-mono text-[10px]">
                      esc
                    </kbd>
                    close
                  </span>
                </div>
                <span>{filtered.length} commands</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
