import { useEffect, useState } from 'react';
import { FolderOpen, Maximize2, Minimize2, Minus, PanelLeft, Terminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import lunarLogo from '../../../../../resources/lunar.png';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  useEffect(() => {
    const check = async () => setIsMaximized(await window.api.window.isMaximized());
    check();
    // Re-check on resize so the icon stays correct after OS window management
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleMinimize = () => window.api.window.minimize();
  const handleMaximize = async () => {
    await window.api.window.maximize();
    setIsMaximized(await window.api.window.isMaximized());
  };
  const handleClose = () => window.api.window.close();

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
          <img src={lunarLogo} alt="Lunar Logo" className="h-[18px] w-[18px] object-contain" />
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Lunar</span>
        </div>

        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className={cn('btn-icon', !sidebarOpen && 'text-muted-foreground/50')}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        {/* View Switcher */}
        <div className="ml-1 flex items-center rounded-lg bg-muted/60 p-[3px]">
          <ViewTab
            active={activeView === 'terminal'}
            onClick={() => setActiveView('terminal')}
            icon={<Terminal className="h-3.5 w-3.5" />}
            label="Terminal"
          />
          <ViewTab
            active={activeView === 'sftp'}
            onClick={() => setActiveView('sftp')}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="SFTP"
          />
        </div>
      </div>

      {/* Center: drag region */}
      <div className="flex-1" />

      {/* Right: window controls */}
      <div className="no-drag flex items-center gap-0.5">
        {!isMac && (
          <>
            <div className="mx-1.5 h-3.5 w-px bg-border/60" />

            <button onClick={handleMinimize} className="btn-icon" aria-label="Minimize">
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleMaximize}
              className="btn-icon"
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="btn-icon hover:!bg-red-500/90 hover:!text-white"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
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
