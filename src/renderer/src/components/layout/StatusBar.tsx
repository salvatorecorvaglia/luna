import type { ActivePortForwardInfo } from '@shared/types/connection';
import { Activity, Network, Upload, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TunnelManagerDialog } from '@/components/connection/TunnelManagerDialog';
import { cn } from '@/lib/utils';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';
import { useTransferStore } from '@/stores/transfer-store';

export function StatusBar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const transfers = useTransferStore((s) => s.transfers);
  const toggleQueueExpanded = useTransferStore((s) => s.toggleQueueExpanded);

  const [tunnels, setTunnels] = useState<ActivePortForwardInfo[]>([]);
  const [tunnelDialogOpen, setTunnelDialogOpen] = useState(false);

  useEffect(() => {
    let unmounted = false;
    const fetchTunnels = async () => {
      try {
        const list = await getApi().ssh.listActivePortForwards();
        if (!unmounted) setTunnels(list);
      } catch {
        // Ignored
      }
    };
    fetchTunnels();
    const interval = setInterval(fetchTunnels, 3000);
    return () => {
      unmounted = true;
      clearInterval(interval);
    };
  }, []);

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const activeSessions = useMemo(
    () => Array.from(sessions.values()).filter((s) => s.status === 'connected').length,
    [sessions],
  );

  const activeTransfers = useMemo(
    () =>
      Array.from(transfers.values()).filter((t) => t.status === 'active' || t.status === 'queued'),
    [transfers],
  );

  return (
    <>
      <div className="flex h-[26px] items-center justify-between border-t border-border/60 bg-card/60 px-3 text-[11px] text-muted-foreground no-select">
        {/* Left */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {activeSession ? (
            <div className="flex min-w-0 items-center gap-1.5">
              {activeSession.status === 'connected' ? (
                <Wifi className="size-3.5 flex-shrink-0 text-success" />
              ) : (
                <WifiOff className="size-3.5 flex-shrink-0 text-destructive-fg" />
              )}
              <span
                className="max-w-[240px] truncate font-medium text-foreground/90"
                title={activeSession.connectionName}
              >
                {activeSession.connectionName}
              </span>
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider',
                  activeSession.status === 'connected'
                    ? 'bg-success/10 text-success'
                    : activeSession.status === 'error'
                      ? 'bg-destructive/10 text-destructive-fg'
                      : 'bg-warning/10 text-warning',
                )}
              >
                {activeSession.status}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">No active connection</span>
          )}

          {activeSessions > 1 && (
            <>
              <div className="h-3 w-px bg-border/60" />
              <div className="flex items-center gap-1">
                <Activity className="size-3" />
                <span>{activeSessions} sessions</span>
              </div>
            </>
          )}

          <div className="h-3 w-px bg-border/60" />
          <button
            onClick={() => setTunnelDialogOpen(true)}
            className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
            title="Manage Port Forwards & SOCKS5 Tunnels"
          >
            <Network className="size-3 text-primary/80" />
            <span className="font-medium">
              {tunnels.length} tunnel{tunnels.length !== 1 ? 's' : ''}
            </span>
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {activeTransfers.length > 0 ? (
            <button
              onClick={toggleQueueExpanded}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Upload className="size-3" />
              <span className="font-medium">
                {activeTransfers.length} transfer{activeTransfers.length !== 1 ? 's' : ''}
              </span>
            </button>
          ) : (
            activeSessions > 0 && (
              <span className="text-muted-foreground">
                {activeSessions} session{activeSessions !== 1 ? 's' : ''}
              </span>
            )
          )}
        </div>
      </div>

      <TunnelManagerDialog open={tunnelDialogOpen} onClose={() => setTunnelDialogOpen(false)} />
    </>
  );
}
