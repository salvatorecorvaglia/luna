import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import {
  ChevronRight,
  Copy,
  FolderClosed,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUIStore } from '@/stores/ui-store';
import { useConnectionStore } from '@/stores/connection-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnections, useDeleteConnection } from '@/hooks/use-connections';
import { connectToHost } from '@/lib/ssh';
import { connectToS3 } from '@/lib/s3';
import { useSftpStore } from '@/stores/sftp-store';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const sidebarSectionOrder = useUIStore((s) => s.sidebarSectionOrder);
  const setSidebarSectionOrder = useUIStore((s) => s.setSidebarSectionOrder);

  const [draggingSection, setDraggingSection] = useState<string | null>(null);

  const { openCreateForm } = useConnectionStore();
  const { data: connections, isLoading } = useConnections();
  const connectionList = useMemo(() => connections ?? [], [connections]);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connectionList;
    const q = searchQuery.toLowerCase();
    return connectionList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q),
    );
  }, [connectionList, searchQuery]);

  const groupedByProvider = useMemo(() => {
    const sftp = filteredConnections.filter((c) => !c.provider || c.provider === 'sftp');
    const s3 = filteredConnections.filter((c) => c.provider === 's3');
    return { sftp, s3 };
  }, [filteredConnections]);

  const [resizing, setResizing] = useState(false);
  // Guard against double mousedown without an intervening mouseup (e.g. dev-tools
  // stealing focus mid-drag) attaching duplicate listeners.
  const resizingRef = useRef(false);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (resizingRef.current) return;
      resizingRef.current = true;
      setResizing(true);
      const onMouseMove = (e: MouseEvent) => {
        const width = Math.max(200, Math.min(400, e.clientX));
        setSidebarWidth(width);
      };
      const onMouseUp = () => {
        resizingRef.current = false;
        setResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [setSidebarWidth],
  );

  return (
    <AnimatePresence mode="wait">
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: sidebarWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="relative flex h-full flex-col border-r border-border/60 bg-sidebar overflow-hidden no-select"
          style={{ willChange: 'width' }}
        >
          {/* Connections Header */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
              Connections
            </span>
            <button
              onClick={() => openCreateForm()}
              className="btn-icon !p-1"
              title="New connection"
              aria-label="New connection"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Search */}
          {connectionList.length > 0 && (
            <div className="px-2 pb-1.5">
              <div className="relative">
                <Search
                  className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter connections..."
                  aria-label="Filter connections"
                  className="form-input !py-1 !pl-7 !pr-7 !text-xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="input-clear-btn"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Connection List */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {isLoading ? (
              <div className="space-y-2 px-2 py-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="skeleton h-2.5 w-2.5 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-3 w-3/4" />
                      <div className="skeleton h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConnections.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <Server className="mx-auto h-8 w-8 text-muted-foreground/30" />
                <p className="mt-3 text-xs font-medium text-muted-foreground/70">
                  {searchQuery ? 'No matching connections' : 'No connections yet'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => openCreateForm()}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sidebar-primary hover:underline cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    Add your first connection
                  </button>
                )}
              </div>
            ) : (
              <Reorder.Group
                axis="y"
                values={sidebarSectionOrder}
                onReorder={setSidebarSectionOrder}
                className="space-y-4"
              >
                {sidebarSectionOrder.map((sectionId) => {
                  if (sectionId === 'ssh' && groupedByProvider.sftp.length > 0) {
                    return (
                      <Reorder.Item
                        key="ssh"
                        value="ssh"
                        initial={false}
                        onDragStart={() => setDraggingSection('ssh')}
                        onDragEnd={() => setTimeout(() => setDraggingSection(null), 100)}
                        className="space-y-1 bg-sidebar"
                      >
                        <div className="flex items-center justify-between px-2.5 pb-1 cursor-grab active:cursor-grabbing">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                            <Terminal className="h-3 w-3" />
                            <span>SSH Sessions</span>
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          {groupedByProvider.sftp.map((conn) => (
                            <ConnectionItem
                              key={conn.id}
                              connection={conn}
                              disabled={!!draggingSection}
                            />
                          ))}
                        </div>
                      </Reorder.Item>
                    );
                  }
                  if (sectionId === 's3' && groupedByProvider.s3.length > 0) {
                    return (
                      <Reorder.Item
                        key="s3"
                        value="s3"
                        initial={false}
                        onDragStart={() => setDraggingSection('s3')}
                        onDragEnd={() => setTimeout(() => setDraggingSection(null), 100)}
                        className="space-y-1 bg-sidebar"
                      >
                        <div className="flex items-center justify-between px-2.5 pb-1 cursor-grab active:cursor-grabbing">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                            <FolderClosed className="h-3 w-3" />
                            <span>S3 Storage</span>
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          {groupedByProvider.s3.map((conn) => (
                            <ConnectionItem
                              key={conn.id}
                              connection={conn}
                              disabled={!!draggingSection}
                            />
                          ))}
                        </div>
                      </Reorder.Item>
                    );
                  }
                  return null;
                })}
              </Reorder.Group>
            )}
          </div>

          {/* Settings — visually separated footer region so it isn't
              read as another connection group. */}
          <div className="border-t border-border bg-sidebar-accent/40 p-1.5">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>
          </div>

          {/* Resize handle */}
          <div className="absolute right-0 top-0 bottom-0 w-px cursor-col-resize">
            <div
              className={cn(
                'absolute inset-0 bg-border',
                resizing ? 'bg-primary/60' : 'hover:bg-primary/40',
              )}
              style={{ transition: 'background-color 150ms' }}
            />
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute -left-1 -right-1 inset-y-0 cursor-col-resize"
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const ConnectionItem = memo(function ConnectionItem({
  connection,
  compact = false,
  disabled = false,
}: {
  connection: {
    id: string;
    name: string;
    host: string;
    username: string;
    port: number;
    colorTag?: string;
    provider?: 'sftp' | 's3';
    endpoint?: string;
    region?: string;
    defaultBucket?: string;
  };
  compact?: boolean;
  disabled?: boolean;
}) {
  const { activeConnectionId, setActiveConnectionId, openEditForm, openDuplicateForm } =
    useConnectionStore();
  const { setActiveView } = useUIStore();
  const { sessions } = useTerminalStore();
  const storageSessions = useSftpStore((s) => s.storageSessions);
  const setSftpSessionId = useSftpStore((s) => s.setSftpSessionId);
  const deleteMutation = useDeleteConnection();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isActive = activeConnectionId === connection.id;
  const isS3 = connection.provider === 's3';
  const isConnected = isS3
    ? Array.from(storageSessions.values()).some(
        (s) => s.connectionId === connection.id && s.status === 'connected',
      )
    : Array.from(sessions.values()).some(
        (s) => s.connectionId === connection.id && s.status === 'connected',
      );
  const isConnecting = isS3
    ? Array.from(storageSessions.values()).some(
        (s) => s.connectionId === connection.id && s.status === 'connecting',
      )
    : Array.from(sessions.values()).some(
        (s) =>
          s.connectionId === connection.id &&
          (s.status === 'connecting' || s.status === 'reconnecting'),
      );

  const handleConnect = () => {
    if (disabled) return;
    setActiveConnectionId(connection.id);

    if (isS3) {
      // S3 connections have no terminal — open the file browser directly.
      setActiveView('sftp');
      const latestStorageSessions = useSftpStore.getState().storageSessions;
      const existing = Array.from(latestStorageSessions.values()).find(
        (s) => s.connectionId === connection.id && s.status !== 'error',
      );
      if (existing) {
        setSftpSessionId(existing.id);
        return;
      }
      connectToS3(connection.id);
      return;
    }

    setActiveView('terminal');

    // If already connected, switch to the existing tab instead of opening a new one
    const latestSessions = useTerminalStore.getState().sessions;
    const existingSession = Array.from(latestSessions.values()).find(
      (s) =>
        s.connectionId === connection.id &&
        (s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting'),
    );
    if (existingSession) {
      useTerminalStore.getState().setActiveTab(existingSession.id);
      return;
    }

    connectToHost(connection.id);
  };

  const handleDisconnect = async () => {
    try {
      if (isS3) {
        const existing = Array.from(useSftpStore.getState().storageSessions.values()).find(
          (s) => s.connectionId === connection.id,
        );
        if (existing) {
          window.api.transfers?.cancelBySession?.(existing.id).catch(() => {});
          await window.api.s3.disconnect(existing.id);
          useSftpStore.getState().removeStorageSession(existing.id);
          if (useSftpStore.getState().sftpSessionId === existing.id) {
            useSftpStore.getState().setSftpSessionId(null);
            useUIStore.getState().setActiveView('welcome');
          }
          toast.success('S3 session closed');
        }
      } else {
        const activeSshSessions = Array.from(useTerminalStore.getState().sessions.values()).filter(
          (s) => s.connectionId === connection.id,
        );
        for (const s of activeSshSessions) {
          window.api.transfers?.cancelBySession?.(s.id).catch(() => {});
          useTerminalStore.getState().closeTab(s.id);
        }
        if (useTerminalStore.getState().sessions.size === 0) {
          useUIStore.getState().setActiveView('welcome');
        }
        if (activeSshSessions.length > 0) {
          toast.success('SSH session disconnected');
        }
      }
    } catch (err) {
      console.error('Disconnect failed:', err);
      toast.error('Failed to disconnect cleanly');
    }
  };

  const handleReconnect = async () => {
    try {
      const sessionId = isS3
        ? Array.from(useSftpStore.getState().storageSessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id
        : Array.from(useTerminalStore.getState().sessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id;

      if (sessionId) {
        window.api.transfers?.cancelBySession?.(sessionId).catch(() => {});
        if (isS3) {
          await window.api.s3.disconnect(sessionId);
          useSftpStore.getState().removeStorageSession(sessionId);
        } else {
          window.api.ssh.disconnect(sessionId);
          useTerminalStore.getState().removeSession(sessionId);
        }
      }

      // Re-connect after cleanup
      setTimeout(() => {
        handleConnect();
      }, 150);
    } catch (err) {
      console.error('Reconnect failed:', err);
      toast.error('Failed to reconnect');
    }
  };

  const contextMenuItems: ContextMenuItem[] = [
    ...(!isConnected
      ? [
          {
            label: 'Connect',
            icon: <Terminal className="h-3.5 w-3.5" />,
            onClick: handleConnect,
          },
        ]
      : []),
    ...(isConnected || isConnecting
      ? [
          {
            label: 'Reconnect',
            icon: <RefreshCw className="h-3.5 w-3.5" />,
            onClick: handleReconnect,
          },
          {
            label: 'Disconnect',
            icon: <LogOut className="h-3.5 w-3.5" />,
            onClick: handleDisconnect,
          },
        ]
      : []),
    {
      label: 'Edit',
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => openEditForm(connection.id),
    },
    {
      label: 'Duplicate',
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: () => openDuplicateForm(connection.id),
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => setConfirmDelete(true),
      destructive: true,
      separator: true,
    },
  ];

  const statusLabel = isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected';

  return (
    <>
      <ContextMenu items={contextMenuItems}>
        <button
          onClick={handleConnect}
          aria-label={`${connection.name} (${connection.username}@${connection.host}) — ${statusLabel}`}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left cursor-pointer',
            compact ? 'py-[7px]' : 'py-2',
            isActive
              ? 'bg-sidebar-accent border-l-[3px] border-l-sidebar-primary pl-[7px]'
              : 'hover:bg-sidebar-accent/60',
          )}
        >
          {/* Status indicator — shape + color so colorblind users can
              still distinguish states. Connected: solid dot with ring.
              Connecting: spinner. Disconnected: hollow ring. */}
          <div className="relative flex-shrink-0" aria-hidden="true">
            {isConnecting ? (
              <Loader2 className="h-3 w-3 text-amber-500 animate-spin" strokeWidth={2.5} />
            ) : isConnected ? (
              <div
                className={cn(
                  'h-2.5 w-2.5 rounded-full ring-2 ring-emerald-500/30',
                  !connection.colorTag && 'bg-emerald-500',
                )}
                style={connection.colorTag ? { backgroundColor: connection.colorTag } : undefined}
              />
            ) : (
              <div
                className={cn(
                  'h-2.5 w-2.5 rounded-full border-[1.5px] border-muted-foreground/60',
                  connection.colorTag && 'opacity-60',
                )}
                style={
                  connection.colorTag
                    ? { borderColor: connection.colorTag, backgroundColor: 'transparent' }
                    : undefined
                }
              />
            )}
          </div>
          <span className="sr-only" aria-live="polite">
            {statusLabel}
          </span>

          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[13px] font-medium text-sidebar-foreground"
              title={connection.name}
            >
              {connection.name}
            </div>
            {!compact && (
              <div
                className="truncate text-[11px] text-muted-foreground"
                title={
                  isS3
                    ? `${connection.endpoint || connection.region || 'S3 Storage'}${
                        connection.defaultBucket ? ' / ' + connection.defaultBucket : ''
                      }`
                    : `${connection.username}@${connection.host}${
                        connection.port !== 22 ? ':' + connection.port : ''
                      }`
                }
              >
                {isS3 ? (
                  <>
                    {connection.endpoint || connection.region || 'S3 Storage'}
                    {connection.defaultBucket && ` / ${connection.defaultBucket}`}
                  </>
                ) : (
                  <>
                    {connection.username}@{connection.host}
                    {connection.port !== 22 && `:${connection.port}`}
                  </>
                )}
              </div>
            )}
          </div>

          <ChevronRight
            aria-hidden="true"
            className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 flex-shrink-0 transition-colors"
          />
        </button>
      </ContextMenu>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete connection?"
        message={`"${connection.name}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteMutation.mutate(connection.id, {
            onSuccess: () => toast.success('Connection deleted'),
            onError: () => toast.error('Failed to delete connection'),
          });
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
});
