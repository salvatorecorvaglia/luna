import type { ActivePortForwardInfo } from '@shared/types/connection';
import { useQuery } from '@tanstack/react-query';
import { Activity, Network, Upload, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { TunnelManagerDialog } from '@/components/connection/TunnelManagerDialog';
import { cn } from '@/lib/utils';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';
import { useTransferStore } from '@/stores/transfer-store';

export function StatusBar() {
  // Every selector here reduces to a primitive or to the one session object
  // this bar displays, rather than subscribing to the Maps.
  //
  // The store replaces `sessions` and `transfers` wholesale on every change, so
  // subscribing to either meant the status bar re-rendered on every SSH status
  // tick and once per animation frame for the whole duration of any transfer.
  // Reducing inside the selector lets zustand compare the derived value and skip
  // the render when the number on screen has not moved.
  const activeSession = useTerminalStore((s) =>
    s.activeSessionId ? (s.sessions.get(s.activeSessionId) ?? null) : null,
  );
  const toggleQueueExpanded = useTransferStore((s) => s.toggleQueueExpanded);

  const [tunnelDialogOpen, setTunnelDialogOpen] = useState(false);

  const hasSshSessions = useTerminalStore((s) => {
    for (const session of s.sessions.values()) {
      if (session.type !== 'local') return true;
    }
    return false;
  });

  /**
   * Was a raw `setInterval(fetchTunnels, 3000)` that ran for the lifetime of
   * the component — with zero SSH sessions, and while the window was hidden or
   * the machine asleep. As a query it stops when there is nothing to poll for
   * (`enabled`), pauses in the background (`refetchIntervalInBackground` is off
   * by default), dedupes against any other consumer, and gets an error state
   * instead of a silently swallowed catch.
   */
  const { data: tunnels = [] } = useQuery<ActivePortForwardInfo[]>({
    queryKey: ['port-forwards'],
    queryFn: () => getApi().ssh.listActivePortForwards(),
    refetchInterval: 3000,
    enabled: hasSshSessions,
    // A transient IPC failure should not blank the tunnel indicator.
    placeholderData: (prev) => prev,
    staleTime: 0,
  });

  const activeSessions = useTerminalStore((s) => {
    let count = 0;
    for (const session of s.sessions.values()) {
      if (session.status === 'connected') count++;
    }
    return count;
  });

  const activeTransferCount = useTransferStore((s) => {
    let count = 0;
    for (const transfer of s.transfers.values()) {
      if (transfer.status === 'active' || transfer.status === 'queued') count++;
    }
    return count;
  });

  return (
    <>
      <div className="flex h-[26px] items-center justify-between border-t border-border/60 bg-card/60 px-3 text-2xs text-muted-foreground no-select">
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
                  'flex-shrink-0 rounded-full px-1.5 py-px text-3xs font-semibold uppercase tracking-wider',
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
            type="button"
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
          {activeTransferCount > 0 ? (
            <button
              type="button"
              onClick={toggleQueueExpanded}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Upload className="size-3" />
              <span className="font-medium">
                {activeTransferCount} transfer{activeTransferCount !== 1 ? 's' : ''}
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
