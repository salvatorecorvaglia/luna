import { CheckSquare, Radio, Send, Square, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';

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

  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);

  // Keep selected ids updated when session list changes
  const effectiveSelectedIds = useMemo(() => {
    if (selectedSessionIds.length === 0) {
      return activeConnectedSessions.map((s) => s.id);
    }
    return selectedSessionIds.filter((id) => activeConnectedSessions.some((s) => s.id === id));
  }, [selectedSessionIds, activeConnectedSessions]);

  const toggleSelectAll = () => {
    if (effectiveSelectedIds.length === activeConnectedSessions.length) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(activeConnectedSessions.map((s) => s.id));
    }
  };

  const toggleSelectId = (id: string) => {
    if (effectiveSelectedIds.includes(id)) {
      setSelectedSessionIds(effectiveSelectedIds.filter((x) => x !== id));
    } else {
      setSelectedSessionIds([...effectiveSelectedIds, id]);
    }
  };

  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastText.trim()) return;
    if (effectiveSelectedIds.length === 0) {
      toast.error('No target terminal sessions selected');
      return;
    }

    const dataToSend = `${broadcastText}\n`;
    for (const sessionId of effectiveSelectedIds) {
      const session = sessions.get(sessionId);
      if (!session) continue;
      if (session.type === 'local') {
        getApi().localTerminal.sendData({ sessionId, data: dataToSend });
      } else {
        getApi().ssh.sendData({ sessionId, data: dataToSend });
      }
    }

    toast.success(`Broadcasted command to ${effectiveSelectedIds.length} terminals`);
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
          onClick={toggleSelectAll}
          className="flex items-center gap-1 rounded bg-muted/80 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted cursor-pointer flex-shrink-0"
        >
          {effectiveSelectedIds.length === activeConnectedSessions.length ? (
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
              key={s.id}
              onClick={() => toggleSelectId(s.id)}
              className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] flex-shrink-0 cursor-pointer transition-colors ${
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
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
        >
          <Send className="size-3" />
          Send
        </button>
      </form>

      <button
        onClick={onClose}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
        title="Close Broadcast Mode"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
