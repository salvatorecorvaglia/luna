import { Search, X } from 'lucide-react';

interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function SidebarSearch({ value, onChange }: SidebarSearchProps) {
  return (
    <div className="px-2 pb-1.5">
      <div className="relative">
        <Search
          className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50"
          aria-hidden="true"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter connections..."
          aria-label="Filter connections"
          className="form-input !py-1 !pl-7 !pr-7 !text-xs"
        />
        {value && (
          // biome-ignore lint/a11y/useButtonType: suppressed during migration
          <button
            onClick={() => onChange('')}
            className="input-clear-btn"
            aria-label="Clear search"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
