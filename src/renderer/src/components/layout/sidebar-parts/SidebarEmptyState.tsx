import { Plus, Server } from 'lucide-react';

interface SidebarEmptyStateProps {
  hasQuery: boolean;
  onCreate: () => void;
}

export function SidebarEmptyState({ hasQuery, onCreate }: SidebarEmptyStateProps) {
  return (
    <div className="px-3 py-10 text-center">
      <Server className="mx-auto size-8 text-muted-foreground/30" />
      <p className="mt-3 text-xs font-medium text-muted-foreground/70">
        {hasQuery ? 'No matching connections' : 'No connections'}
      </p>
      {!hasQuery && (
        // biome-ignore lint/a11y/useButtonType: suppressed during migration
        <button
          onClick={onCreate}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sidebar-primary hover:underline cursor-pointer"
        >
          <Plus className="size-3" />
          Add your first connection
        </button>
      )}
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-2 px-2 py-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <div className="skeleton size-2.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton size-3/4" />
            <div className="skeleton h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
