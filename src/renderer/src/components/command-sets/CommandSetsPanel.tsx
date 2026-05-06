import { memo, useState } from 'react';
import { ChevronDown, Pencil, Play, Plus, Terminal, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnections } from '@/hooks/use-connections';
import {
  useCommandSets,
  useCreateCommandSet,
  useDeleteCommandSet,
  useUpdateCommandSet,
} from '@/hooks/use-command-sets';
import { runCommandSetSequence, type ItemStatus } from '@/lib/command-set-runner';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CommandSetForm } from './CommandSetForm';
import type { CommandSet, CommandSetItem, CreateCommandSetInput } from '@shared/types/command-set';

// ─── CommandSetItemRow ────────────────────────────────────────────────────────

const CommandSetItemRow = memo(function CommandSetItemRow({
  item,
  status,
  disabled,
  onRun,
}: {
  item: CommandSetItem;
  status: ItemStatus;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <button
      onClick={onRun}
      disabled={disabled}
      title={disabled ? 'No active session' : `Send: ${item.command}`}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-sidebar-accent/60 cursor-pointer',
      )}
    >
      {/* Status indicator */}
      <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {status === 'running' && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        )}
        {status === 'success' && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
        {status === 'failed' && <span className="h-2 w-2 rounded-full bg-destructive" />}
        {status === 'idle' && (
          <Terminal className="h-3 w-3 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/70" />
        )}
      </span>
      <span className="flex-1 truncate text-[12px] text-sidebar-foreground/80">{item.label}</span>
    </button>
  );
});

// ─── CommandSetGroup ──────────────────────────────────────────────────────────

function CommandSetGroup({
  set,
  activeSessionId,
  onEdit,
  onDelete,
}: {
  set: CommandSet;
  activeSessionId: string | null;
  onEdit: (set: CommandSet) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [itemStatuses, setItemStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [running, setRunning] = useState(false);

  const disabled = !activeSessionId;

  const resetStatuses = () => setItemStatuses(new Map());

  const handleRunSingle = (item: CommandSetItem) => {
    if (!activeSessionId) return;
    resetStatuses();
    window.api.ssh.sendData({ sessionId: activeSessionId, data: item.command + '\n' });
  };

  const handleRunAll = () => {
    if (!activeSessionId || running) return;
    resetStatuses();
    setRunning(true);

    runCommandSetSequence(set.items, activeSessionId, {
      onItemStart: (id) => setItemStatuses((prev) => new Map(prev).set(id, 'running')),
      onItemSuccess: (id) => setItemStatuses((prev) => new Map(prev).set(id, 'success')),
      onItemFailed: (id, reason) => {
        setItemStatuses((prev) => new Map(prev).set(id, 'failed'));
        const label = set.items.find((i) => i.id === id)?.label ?? id;
        toast.error(`"${label}" failed: ${reason}`);
        setRunning(false);
      },
      onComplete: () => {
        toast.success(`"${set.name}" completed`);
        setRunning(false);
      },
    });
  };

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Edit',
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => onEdit(set),
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => onDelete(set.id),
      destructive: true,
      separator: true,
    },
  ];

  return (
    <ContextMenu items={contextMenuItems}>
      <div>
        {/* Set header */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/40"
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 flex-shrink-0 text-muted-foreground/60 transition-transform duration-150',
              !open && '-rotate-90',
            )}
          />
          <Zap className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
          <span className="flex-1 truncate text-[12px] font-medium text-sidebar-foreground/90">
            {set.name}
          </span>
          {set.connectionId && (
            <span className="flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-medium bg-sidebar-primary/10 text-sidebar-primary/70">
              linked
            </span>
          )}
          <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">
            {set.items.length}
          </span>
        </button>

        {/* Items list */}
        {open && set.items.length > 0 && (
          <div className="ml-2 border-l border-border/40 pl-1 pb-1 space-y-0.5">
            {set.items.map((item) => (
              <CommandSetItemRow
                key={item.id}
                item={item}
                status={itemStatuses.get(item.id) ?? 'idle'}
                disabled={disabled}
                onRun={() => handleRunSingle(item)}
              />
            ))}

            {/* Run All button — only shown when there are multiple items */}
            {set.items.length > 1 && (
              <button
                onClick={handleRunAll}
                disabled={disabled || running}
                className={cn(
                  'mt-1 flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium transition-colors',
                  disabled || running
                    ? 'cursor-not-allowed opacity-40'
                    : 'bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20',
                )}
              >
                <Play className="h-3 w-3" />
                {running ? 'Running…' : 'Run All'}
              </button>
            )}
          </div>
        )}
      </div>
    </ContextMenu>
  );
}

// ─── CommandSetsPanel ─────────────────────────────────────────────────────────

export const CommandSetsPanel = memo(function CommandSetsPanel() {
  const { data: sets = [], isLoading } = useCommandSets();
  const { data: connections = [] } = useConnections();
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const sessions = useTerminalStore((s) => s.sessions);

  const createMutation = useCreateCommandSet();
  const updateMutation = useUpdateCommandSet();
  const deleteMutation = useDeleteCommandSet();

  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<CommandSet | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // The active session's connectionId — used to filter linked sets
  const activeConnectionId = activeTabId ? sessions.get(activeTabId)?.connectionId : null;

  // Show global sets always + sets linked to the currently active connection
  const visibleSets = sets.filter((s) => !s.connectionId || s.connectionId === activeConnectionId);

  const handleSubmit = (input: CreateCommandSetInput) => {
    if (editTarget) {
      updateMutation.mutate(
        {
          id: editTarget.id,
          name: input.name,
          items: input.items.map((i, idx) => ({ ...i, sortOrder: idx })),
        },
        {
          onSuccess: () => toast.success('Command set updated'),
          onError: () => toast.error('Failed to update command set'),
        },
      );
    } else {
      createMutation.mutate(input, {
        onSuccess: () => toast.success('Command set created'),
        onError: () => toast.error('Failed to create command set'),
      });
    }
    setShowForm(false);
    setEditTarget(null);
  };

  const openEdit = (set: CommandSet) => {
    setEditTarget(set);
    setShowForm(true);
  };

  const openCreate = () => {
    setEditTarget(null);
    setShowForm(true);
  };

  if (isLoading) return null;

  return (
    <>
      <div className="border-t border-border/60 px-1.5 pb-1.5 pt-1">
        {/* Section header */}
        <div className="flex items-center gap-1 px-1 py-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex flex-1 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform duration-150', !open && '-rotate-90')}
            />
            <Zap className="h-3 w-3" />
            <span>Command Sets</span>
          </button>
          <button
            onClick={openCreate}
            className="btn-icon !p-1"
            title="New command set"
            aria-label="New command set"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Sets list */}
        {open && (
          <div className="space-y-0.5">
            {visibleSets.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-muted-foreground/50">
                No command sets yet
              </p>
            ) : (
              visibleSets.map((set) => (
                <CommandSetGroup
                  key={set.id}
                  set={set}
                  activeSessionId={activeTabId}
                  onEdit={openEdit}
                  onDelete={(id) => setConfirmDeleteId(id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <CommandSetForm
          connections={connections}
          initialData={editTarget ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditTarget(null);
          }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete command set?"
        message="This command set and all its commands will be permanently deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!confirmDeleteId) return;
          deleteMutation.mutate(confirmDeleteId, {
            onSuccess: () => toast.success('Command set deleted'),
            onError: () => toast.error('Failed to delete command set'),
          });
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
});
