import { Eye, EyeOff, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarHeaderProps {
  showHiddenConnections: boolean;
  onToggleHidden: () => void;
  onNewConnection: () => void;
}

export function SidebarHeader({
  showHiddenConnections,
  onToggleHidden,
  onNewConnection,
}: SidebarHeaderProps) {
  const toggleLabel = showHiddenConnections
    ? 'Hide background connections'
    : 'Show background connections';

  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
        Connections
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleHidden}
          className={cn(
            'btn-icon !p-1',
            showHiddenConnections ? 'text-primary' : 'text-muted-foreground/50',
          )}
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {showHiddenConnections ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={onNewConnection}
          className="btn-icon !p-1"
          title="New connection"
          aria-label="New connection"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
