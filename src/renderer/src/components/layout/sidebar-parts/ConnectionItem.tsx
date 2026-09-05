import type { Connection } from '@shared/types/ipc';
import type { DragControls } from 'framer-motion';
import { Reorder, useDragControls } from 'framer-motion';
import {
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  LogOut,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { useDeleteConnection, useUpdateConnection } from '@/hooks/use-connections';
import { connectToS3 } from '@/lib/s3';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import { getApi } from '@/services/api';
import { useConnectionStore } from '@/stores/connection-store';
import { useStorageStore } from '@/stores/storage-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

/**
 * Reorder.Item wrapper so each connection row can participate in framer-motion's
 * drag-to-reorder without leaking the drag controls back up to the parent.
 */
export function DraggableConnectionItem({
  connection,
  disabled,
  onDragStart,
  onDragEnd,
}: {
  connection: Connection;
  disabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={connection}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-sidebar"
    >
      <ConnectionItem connection={connection} disabled={disabled} dragControls={controls} />
    </Reorder.Item>
  );
}

export function ConnectionItem({
  connection,
  compact = false,
  disabled = false,
  dragControls,
}: {
  connection: Connection;
  compact?: boolean;
  disabled?: boolean;
  dragControls: DragControls;
}) {
  // Individual selectors, not whole-store subscriptions.
  //
  // This component is rendered once per connection row, and it used to
  // subscribe to all of `useConnectionStore()` and all of `useUIStore()`. In
  // zustand v5 that re-renders on *any* field change — so dragging the sidebar
  // divider, which fires `setSidebarWidth` on every mousemove, re-rendered
  // every row in the list, each inside a framer-motion `Reorder.Item`. The
  // `sessions` selectors below already had this right.
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const setActiveConnectionId = useConnectionStore((s) => s.setActiveConnectionId);
  const openEditForm = useConnectionStore((s) => s.openEditForm);
  const openDuplicateForm = useConnectionStore((s) => s.openDuplicateForm);
  const setActiveView = useUIStore((s) => s.setActiveView);
  // Narrow selector (only re-renders when the `sessions` Map reference itself
  // changes, not on unrelated store fields) rather than subscribing to the
  // whole store.
  const sessions = useTerminalStore((s) => s.sessions);
  const storageSessions = useStorageStore((s) => s.storageSessions);
  const setActiveSessionId = useStorageStore((s) => s.setActiveSessionId);
  const deleteMutation = useDeleteConnection();
  const updateMutation = useUpdateConnection();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isS3 = connection.provider === 's3';
  // Single pass over the relevant session map instead of two separate
  // `Array.from(...).some(...)` scans (one per flag) — this ran on every
  // sidebar-row render, unmemoized, so cost grew with rows x sessions.
  const { isConnected, isConnecting } = useMemo(() => {
    let connected = false;
    let connecting = false;
    const relevant = isS3 ? storageSessions : sessions;
    for (const s of relevant.values()) {
      if (s.connectionId !== connection.id) continue;
      if (s.status === 'connected') connected = true;
      else if (s.status === 'connecting' || (!isS3 && s.status === 'reconnecting')) {
        connecting = true;
      }
      if (connected && connecting) break;
    }
    return { isConnected: connected, isConnecting: connecting };
  }, [isS3, storageSessions, sessions, connection.id]);
  const isActive = activeConnectionId === connection.id && (isConnected || isConnecting);

  const handleConnect = () => {
    if (disabled) return;
    setActiveConnectionId(connection.id);

    if (isS3) {
      // S3 connections have no terminal — open the file browser directly.
      setActiveView('sftp');
      const latestStorageSessions = useStorageStore.getState().storageSessions;
      const existing = Array.from(latestStorageSessions.values()).find(
        (s) => s.connectionId === connection.id && s.status !== 'error',
      );
      if (existing) {
        setActiveSessionId(existing.id);
        return;
      }
      void connectToS3(connection.id);
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
      useTerminalStore.getState().setActiveSession(existingSession.id);
      return;
    }

    void connectToHost(connection.id);
  };

  const handleDisconnect = async () => {
    try {
      if (isS3) {
        const existing = Array.from(useStorageStore.getState().storageSessions.values()).find(
          (s) => s.connectionId === connection.id,
        );
        if (existing) {
          getApi()
            .transfers?.cancelBySession?.(existing.id)
            .catch(() => {});
          await getApi().s3.disconnect(existing.id);
          useStorageStore.getState().removeStorageSession(existing.id);
          if (useStorageStore.getState().activeSessionId === existing.id) {
            useStorageStore.getState().setActiveSessionId(null);
            useUIStore.getState().setActiveView('welcome');
          }
          toast.success('S3 session closed');
        }
      } else {
        const activeSshSessions = Array.from(useTerminalStore.getState().sessions.values()).filter(
          (s) => s.connectionId === connection.id,
        );
        for (const s of activeSshSessions) {
          getApi()
            .transfers?.cancelBySession?.(s.id)
            .catch(() => {});
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
        ? Array.from(useStorageStore.getState().storageSessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id
        : Array.from(useTerminalStore.getState().sessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id;

      if (sessionId) {
        getApi()
          .transfers?.cancelBySession?.(sessionId)
          .catch(() => {});
        if (isS3) {
          await getApi().s3.disconnect(sessionId);
          useStorageStore.getState().removeStorageSession(sessionId);
        } else {
          // Best-effort teardown — removeSession() below proceeds regardless,
          // and this was previously a bare `void` call that could surface as
          // an unhandled rejection instead of being caught by the try/catch
          // around this function.
          getApi()
            .ssh.disconnect(sessionId)
            .catch(() => {});
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
            icon: <Terminal className="size-3.5" />,
            onClick: handleConnect,
          },
        ]
      : []),
    ...(isConnected || isConnecting
      ? [
          {
            label: 'Reconnect',
            icon: <RefreshCw className="size-3.5" />,
            onClick: handleReconnect,
          },
          {
            label: 'Disconnect',
            icon: <LogOut className="size-3.5" />,
            onClick: handleDisconnect,
          },
        ]
      : []),
    {
      label: 'Edit',
      icon: <Pencil className="size-3.5" />,
      onClick: () => openEditForm(connection.id),
    },
    {
      label: 'Duplicate',
      icon: <Copy className="size-3.5" />,
      onClick: () => openDuplicateForm(connection.id),
    },
    {
      label: connection.isHidden ? 'Show in Sidebar' : 'Hide from Sidebar',
      icon: connection.isHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />,
      onClick: () => {
        updateMutation.mutate({
          id: connection.id,
          isHidden: !connection.isHidden,
        });
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="size-3.5" />,
      onClick: () => setConfirmDelete(true),
      destructive: true,
      separator: true,
    },
  ];

  const statusLabel = isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected';

  /**
   * Where this connection points, in one string.
   *
   * Computed once and used for the row's accessible name, its tooltip, and its
   * visible subtitle. The name previously always read
   * `${username}@${host}` — but `Connection.host` and `username` are empty for
   * S3 connections (see shared/types/connection.ts), so an S3 row announced
   * itself as "my-bucket (@) — connected".
   */
  const targetLabel = isS3
    ? `${connection.endpoint || connection.region || 'S3 Storage'}${
        connection.defaultBucket ? ` / ${connection.defaultBucket}` : ''
      }`
    : `${connection.username}@${connection.host}${
        connection.port !== 22 ? `:${connection.port}` : ''
      }`;

  return (
    <>
      <ContextMenu items={contextMenuItems}>
        {/* The drag handle is a sibling of the activate button, not a child of
            it: a <button> inside a <button> is invalid HTML, and assistive tech
            has no way to represent the nesting. The `group` marker moves to this
            wrapper so the handle's hover reveal still works. */}
        <div
          className={cn(
            'group flex w-full items-center rounded-lg pr-1.5 transition-colors',
            isActive
              ? 'bg-sidebar-accent border-l-[3px] border-l-sidebar-primary pl-[7px]'
              : 'pl-2.5 hover:bg-sidebar-accent/60',
          )}
        >
          <button
            type="button"
            onClick={handleConnect}
            aria-label={`${connection.name} (${targetLabel}) — ${statusLabel}`}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer',
              compact ? 'py-[7px]' : 'py-2',
            )}
          >
            {/* Status indicator — shape + color so colorblind users can
                still distinguish states. Connected: solid dot with ring.
                Connecting: spinner. Disconnected: hollow ring.
                Marked aria-hidden because the status is already in the
                button's accessible name above. */}
            <div className="relative flex-shrink-0" aria-hidden="true">
              {isConnecting ? (
                <Loader2 className="size-3 text-warning animate-spin" strokeWidth={2.5} />
              ) : isConnected ? (
                <div
                  className={cn(
                    'size-2.5 rounded-full ring-2 ring-success/30',
                    !connection.colorTag && 'bg-success',
                  )}
                  style={connection.colorTag ? { backgroundColor: connection.colorTag } : undefined}
                />
              ) : (
                <div
                  className={cn(
                    'size-2.5 rounded-full border-[1.5px] border-muted-foreground/60',
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

            <div className="min-w-0 flex-1">
              <div
                className="truncate text-sm-plus font-medium text-sidebar-foreground"
                title={connection.name}
              >
                {connection.name}
              </div>
              {!compact && (
                <div className="truncate text-2xs text-muted-foreground" title={targetLabel}>
                  {targetLabel}
                </div>
              )}
            </div>

            <ChevronRight
              aria-hidden="true"
              className="size-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 flex-shrink-0 transition-colors"
            />
          </button>

          <button
            type="button"
            aria-label={`Drag to reorder ${connection.name}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragControls.start(e);
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing px-1 py-2 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <GripVertical className="size-3 text-muted-foreground/40" />
          </button>
        </div>
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
}
