import { CheckSquare, Radio, Send, Square, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/ui';
import { getApi } from '@/services/api';
import { type TerminalSession, useTerminalStore } from '@/stores/terminal-store';

type Selection = { mode: 'all' } | { mode: 'custom'; ids: string[] };

interface BroadcastInputBarProps {
  open: boolean;
  onClose: () => void;
}

export function BroadcastInputBar({ open, onClose }: BroadcastInputBarProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const [broadcastText, setBroadcastText] = useState('');

  const activeConnectedSessions = useMemo(() => {
    return Array.from(sessions.values()).filter((s) => s.status === 'connected');
  }, [sessions]);

  // Explicit mode rather than "an empty list means everyone". That convention
  // made deselecting the last session — or toggling "All" off — silently
  // target *every* connected shell, so a command narrowed to one host went to
  // all of them.
  const [selection, setSelection] = useState<Selection>({ mode: 'all' });

  const effectiveSelectedIds = useMemo(() => {
    if (selection.mode === 'all') return activeConnectedSessions.map((s) => s.id);
    return selection.ids.filter((id) => activeConnectedSessions.some((s) => s.id === id));
  }, [selection, activeConnectedSessions]);

  const allSelected =
    activeConnectedSessions.length > 0 &&
    effectiveSelectedIds.length === activeConnectedSessions.length;

  const toggleSelectAll = () => {
    setSelection(allSelected ? { mode: 'custom', ids: [] } : { mode: 'all' });
  };

  const toggleSelectId = (id: string) => {
    setSelection({
      mode: 'custom',
      ids: effectiveSelectedIds.includes(id)
        ? effectiveSelectedIds.filter((x) => x !== id)
        : [...effectiveSelectedIds, id],
    });
  };

  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    if (effectiveSelectedIds.length === 0) {
      toast.error('No target terminal sessions selected');
      return;
    }

    const dataToSend = `${broadcastText}\n`;
    const targets = effectiveSelectedIds
      .map((sessionId) => sessions.get(sessionId))
      .filter((session): session is TerminalSession => session != null);
    const sends = targets.map((session) =>
      session.type === 'local'
        ? getApi().localTerminal.sendData({ sessionId: session.id, data: dataToSend })
        : getApi().ssh.sendData({ sessionId: session.id, data: dataToSend }),
    );

    // Report which sessions actually received the broadcast rather than
    // assuming success — a per-target send can fail independently of the
    // others (e.g. one session dropped mid-broadcast).
    void Promise.allSettled(sends).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === 0) {
        toast.success(`Broadcasted command to ${results.length} terminals`);
      } else if (failed === results.length) {
        toast.error('Failed to broadcast command to any terminal');
      } else {
        toast.warning(`Broadcasted to ${results.length - failed} of ${results.length} terminals`);
      }
    });
    setBroadcastText('');
  };

  if (!open) return null;

  return (
    <div className="flex items-center gap-3 border-b border-primary/30 bg-primary/10 px-4 py-2 text-xs no-select">
      <div className="flex items-center gap-1.5 font-medium text-primary flex-shrink-0">
        <Radio className="size-4 animate-pulse" />
        <span>Input Broadcast</span>
      </div>

      {/* Target Sessions Selection */}
      <div className="flex items-center gap-2 overflow-x-auto min-w-0 flex-1 py-0.5">
        <button
          type="button"
          onClick={toggleSelectAll}
          aria-pressed={allSelected}
          className="flex items-center gap-1 rounded bg-muted/80 px-2 py-1 text-2xs text-muted-foreground hover:bg-muted cursor-pointer flex-shrink-0"
        >
          {allSelected ? (
            <CheckSquare className="size-3 text-primary" />
          ) : (
            <Square className="size-3" />
          )}
          <span>All ({activeConnectedSessions.length})</span>
        </button>

        {activeConnectedSessions.map((s) => {
          const isSelected = effectiveSelectedIds.includes(s.id);
          return (
            <button
              type="button"
              key={s.id}
              onClick={() => toggleSelectId(s.id)}
              aria-pressed={isSelected}
              className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-2xs flex-shrink-0 cursor-pointer transition-colors ${
                isSelected
                  ? 'border-primary/50 bg-primary/20 text-primary font-medium'
                  : 'border-border/60 bg-card/60 text-muted-foreground hover:border-border'
              }`}
            >
              <span className="truncate max-w-[120px]">{s.connectionName || s.title}</span>
            </button>
          );
        })}
      </div>

      {/* Input form */}
      <form onSubmit={handleSendBroadcast} className="flex items-center gap-2 flex-1 max-w-md">
        <input
          type="text"
          value={broadcastText}
          onChange={(e) => setBroadcastText(e.target.value)}
          placeholder="Type command to send to all selected terminals..."
          autoFocus
          className="flex-1 rounded-md border border-primary/30 bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={effectiveSelectedIds.length === 0}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-3" />
          {/* The count is the last thing seen before sending to many shells. */}
          Send to {effectiveSelectedIds.length}
        </button>
      </form>

      <IconButton
        onClick={onClose}
        aria-label="Close Broadcast Mode"
        title="Close Broadcast Mode"
        size="md"
        icon={<X className="size-4" />}
      />
    </div>
  );
}
