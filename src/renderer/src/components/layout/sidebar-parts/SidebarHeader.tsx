import { Eye, EyeOff, Plus } from 'lucide-react';
import { IconButton } from '@/components/ui';
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
      <span className="text-3xs font-bold uppercase tracking-widest text-muted-foreground/70">
        Connections
      </span>
      <div className="flex items-center gap-1">
        <IconButton
          onClick={onToggleHidden}
          className={cn(showHiddenConnections ? '!text-primary' : '!text-muted-foreground/50')}
          title={toggleLabel}
          aria-label={toggleLabel}
          icon={
            showHiddenConnections ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />
          }
        />
        <IconButton
          onClick={onNewConnection}
          title="New connection"
          aria-label="New connection"
          icon={<Plus className="size-3.5" />}
        />
      </div>
    </div>
  );
}
