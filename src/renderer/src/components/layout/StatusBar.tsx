import {Activity, Upload, Wifi, WifiOff} from 'lucide-react'
import {cn} from '@/lib/utils'
import {useTerminalStore} from '@/stores/terminal-store'
import {useTransferStore} from '@/stores/transfer-store'

export function StatusBar() {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const transfers = useTransferStore((s) => s.transfers)
  const toggleQueueExpanded = useTransferStore((s) => s.toggleQueueExpanded)

  const activeSession = activeTabId ? sessions.get(activeTabId) : null
  const activeSessions = Array.from(sessions.values()).filter(
    (s) => s.status === 'connected'
  ).length

  const activeTransfers = Array.from(transfers.values()).filter(
    (t) => t.status === 'active' || t.status === 'queued'
  )

  return (
    <div className="flex h-[26px] items-center justify-between border-t border-border/60 bg-card/60 px-3 text-[11px] text-muted-foreground no-select">
      {/* Left */}
      <div className="flex items-center gap-4">
        {activeSession ? (
          <div className="flex items-center gap-1.5">
            {activeSession.status === 'connected' ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-destructive" />
            )}
            <span className="font-medium text-foreground/80">{activeSession.connectionName}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider',
                activeSession.status === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : activeSession.status === 'error'
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-amber-500/10 text-amber-500'
              )}
            >
              {activeSession.status}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground/50">No active connection</span>
        )}

        {activeSessions > 1 && (
          <>
            <div className="h-3 w-px bg-border/60" />
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>{activeSessions} sessions</span>
            </div>
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {activeTransfers.length > 0 ? (
          <button
            onClick={toggleQueueExpanded}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Upload className="h-3 w-3" />
            <span className="font-medium">
              {activeTransfers.length} transfer{activeTransfers.length !== 1 ? 's' : ''}
            </span>
          </button>
        ) : (
          activeSessions > 0 && (
            <span className="text-muted-foreground/50">
              {activeSessions} session{activeSessions !== 1 ? 's' : ''}
            </span>
          )
        )}
      </div>
    </div>
  )
}
