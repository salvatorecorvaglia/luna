import {
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  PanelLeft,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '@/components/ui';
import { isMac } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { getApi } from '@/services/api';
import { useUIStore } from '@/stores/ui-store';
import lunaLogo from '../../../../../resources/luna.png';

const VIEW_TABS = [
  { view: 'local', icon: Monitor, label: 'Local' },
  { view: 'terminal', icon: Terminal, label: 'Terminal' },
  { view: 'sftp', icon: FolderOpen, label: 'SFTP' },
] as const;

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  // -1 when the current view has no tab (e.g. 'welcome') — fall back to the
  // first tab so the roving tabIndex always has exactly one holder.
  const activeTabIndex = Math.max(
    0,
    VIEW_TABS.findIndex((t) => t.view === activeView),
  );

  useEffect(() => {
    const check = async () => setIsMaximized(await getApi().window.isMaximized());
    void check();
    // Re-check on resize so the icon stays correct after OS window management
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /**
   * Arrow / Home / End movement across the tablist. Selection follows focus,
   * which is the expected behaviour for a tablist whose panels are already
   * mounted — switching views here is free.
   */
  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    let next: number;
    if (e.key in DELTA) {
      // Non-null assertion is safe: the result is taken modulo a non-empty array.
      next = (activeTabIndex + DELTA[e.key]! + VIEW_TABS.length) % VIEW_TABS.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = VIEW_TABS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const target = VIEW_TABS[next]!;
    setActiveView(target.view);
    // Move DOM focus with selection so the roving tabIndex stays coherent.
    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
  };

  const handleMinimize = () => getApi().window.minimize();
  const handleMaximize = async () => {
    await getApi().window.maximize();
    setIsMaximized(await getApi().window.isMaximized());
  };
  const handleClose = () => getApi().window.close();

  return (
    <div
      className={cn(
        'drag-region flex h-[46px] items-center justify-between border-b border-border/60 bg-card/80 backdrop-blur-md px-2 no-select',
        isMac && 'pl-[84px]',
      )}
    >
      {/* Left: logo + sidebar toggle + view switcher */}
      <div className="no-drag flex items-center gap-1.5">
        {/* Logo */}
        <div className="flex items-center gap-2 pl-1 pr-2">
          <img src={lunaLogo} alt="Luna Logo" className="h-[18px] w-[18px] object-contain" />
          <span className="text-sm-plus font-semibold tracking-tight text-foreground">Luna</span>
        </div>

        {/* Sidebar toggle */}

        <IconButton
          size="md"
          onClick={toggleSidebar}
          className={cn(!sidebarOpen && '!text-muted-foreground/50')}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          icon={<PanelLeft className="size-4" />}
        />

        {/* View Switcher — the app's primary navigation, so it is a real
            tablist (matching TerminalTabs) rather than three plain buttons:
            assistive tech gets aria-selected, and arrow keys move between
            views the way a tablist is expected to behave. */}
        <div
          role="tablist"
          aria-label="View"
          onKeyDown={handleTabListKeyDown}
          className="ml-1 flex items-center rounded-lg bg-muted/60 p-[3px]"
        >
          {VIEW_TABS.map(({ view, icon: Icon, label }, i) => (
            <ViewTab
              key={view}
              active={activeView === view}
              // Exactly one tab must stay keyboard-reachable. On views with no
              // tab of their own ('welcome'), `activeTabIndex` falls back to 0
              // so the group doesn't drop out of the tab order entirely.
              tabbable={i === activeTabIndex}
              onClick={() => setActiveView(view)}
              icon={<Icon className="size-3.5" />}
              label={label}
            />
          ))}
        </div>
      </div>

      {/* Center: drag region */}
      <div className="flex-1" />

      {/* Right: window controls */}
      <div className="no-drag flex items-center gap-0.5">
        {!isMac && (
          <>
            <div className="mx-1.5 h-3.5 w-px bg-border/60" />

            <IconButton
              size="md"
              onClick={handleMinimize}
              aria-label="Minimize"
              icon={<Minus className="size-3.5" />}
            />

            <IconButton
              size="md"
              onClick={handleMaximize}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
              icon={
                isMaximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )
              }
            />

            <IconButton
              size="md"
              onClick={handleClose}
              className="hover:!bg-red-500/90 hover:!text-white"
              aria-label="Close"
              icon={<X className="size-3.5" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ViewTab({
  active,
  tabbable,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  /** Holder of the group's single tab stop. See the roving tabIndex note above. */
  tabbable: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      // Roving tabIndex: one stop for the whole group, then arrow keys within.
      tabIndex={tabbable ? 0 : -1}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 rounded-md px-3 py-[5px] text-xs font-medium cursor-pointer',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
