import { Filter, Search, X } from 'lucide-react';
import { useState } from 'react';

interface TerminalFilterBarProps {
  open: boolean;
  onClose: () => void;
  onApplyFilter?: (pattern: string, levelOnly?: 'error' | 'warn' | 'info') => void;
}

export function TerminalFilterBar({ open, onClose, onApplyFilter }: TerminalFilterBarProps) {
  const [filterPattern, setFilterPattern] = useState('');
  const [activeLevel, setActiveLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');

  if (!open) return null;

  const handlePatternChange = (pattern: string) => {
    setFilterPattern(pattern);
    if (onApplyFilter) {
      onApplyFilter(pattern, activeLevel === 'all' ? undefined : activeLevel);
    }
  };

  const handleLevelSelect = (level: 'all' | 'error' | 'warn' | 'info') => {
    setActiveLevel(level);
    if (onApplyFilter) {
      onApplyFilter(filterPattern, level === 'all' ? undefined : level);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-xs no-select">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Filter className="size-3.5 text-primary flex-shrink-0" />
        <span className="font-medium text-foreground/90 flex-shrink-0">Live Stream Filter:</span>

        {/* Severity Toggles */}
        <div className="flex items-center gap-1 bg-background/60 p-0.5 rounded border border-border/60 flex-shrink-0">
          <button
            onClick={() => handleLevelSelect('all')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
              activeLevel === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            ALL
          </button>
          <button
            onClick={() => handleLevelSelect('error')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
              activeLevel === 'error'
                ? 'bg-destructive text-destructive-foreground'
                : 'text-destructive/80 hover:text-destructive'
            }`}
          >
            ERROR
          </button>
          <button
            onClick={() => handleLevelSelect('warn')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
              activeLevel === 'warn'
                ? 'bg-warning text-warning-foreground'
                : 'text-warning/80 hover:text-warning'
            }`}
          >
            WARN
          </button>
          <button
            onClick={() => handleLevelSelect('info')}
            className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${
              activeLevel === 'info'
                ? 'bg-info text-info-foreground'
                : 'text-info/80 hover:text-info'
            }`}
          >
            INFO
          </button>
        </div>

        {/* Regex Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <input
            type="text"
            value={filterPattern}
            onChange={(e) => handlePatternChange(e.target.value)}
            placeholder="Filter terminal output regex (e.g. fatal|panic|connection)..."
            className="w-full rounded-md border border-input bg-background pl-8 pr-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary font-mono"
          />
        </div>
      </div>

      <button
        onClick={onClose}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
        title="Close Filter Bar"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
