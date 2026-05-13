import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion';
import {
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
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
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUIStore } from '@/stores/ui-store';
import { useConnectionStore } from '@/stores/connection-store';
import { useTerminalStore } from '@/stores/terminal-store';
import {
  useConnections,
  useDeleteConnection,
  useUpdateConnection,
  useReorderConnections,
} from '@/hooks/use-connections';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Connection } from '@shared/types/ipc';
import type { DragControls } from 'framer-motion';
import { connectToHost } from '@/lib/ssh';
import { connectToS3 } from '@/lib/s3';
import { useStorageStore } from '@/stores/storage-store';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const sidebarSectionOrder = useUIStore((s) => s.sidebarSectionOrder);
  const setSidebarSectionOrder = useUIStore((s) => s.setSidebarSectionOrder);
  const showHiddenConnections = useUIStore((s) => s.showHiddenConnections);
  const toggleShowHiddenConnections = useUIStore((s) => s.toggleShowHiddenConnections);

  const [draggingSection, setDraggingSection] = useState<string | null>(null);

  const { openCreateForm } = useConnectionStore();
  const { data: connections, isLoading } = useConnections();
  const connectionList = useMemo(() => connections ?? [], [connections]);
  const [searchInputValue, setSearchInputValue] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const reorderMutation = useReorderConnections();

  // Local state for connections to allow smooth reordering
  const [localSshConnections, setLocalSshConnections] = useState<typeof connectionList>([]);
  const [localS3Connections, setLocalS3Connections] = useState<typeof connectionList>([]);
  const [isDraggingConnection, setIsDraggingConnection] = useState(false);

  // Debounce search input to avoid heavy filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchInputValue);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchInputValue]);

  const filteredConnections = useMemo(() => {
    // Filter out hidden connections (like jump hosts) from the sidebar
    // unless the global "show hidden" toggle is ON.
    const visible = connectionList.filter((c) => showHiddenConnections || !c.isHidden);

    if (!debouncedSearchQuery.trim()) return visible;
    const q = debouncedSearchQuery.toLowerCase();
    return visible.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q),
    );
  }, [connectionList, debouncedSearchQuery, showHiddenConnections]);

  const groupedByProvider = useMemo(() => {
    const sftp = filteredConnections.filter((c) => !c.provider || c.provider === 'sftp');
    const s3 = filteredConnections.filter((c) => c.provider === 's3');
    return { sftp, s3 };
  }, [filteredConnections]);

  // Sync local state with grouped connections when not reordering and no mutation is pending
  // Using render-time sync to avoid cascading renders (react-hooks/set-state-in-effect)
  const [prevGroupedByProvider, setPrevGroupedByProvider] = useState(groupedByProvider);
  if (
    groupedByProvider !== prevGroupedByProvider &&
    !isDraggingConnection &&
    !reorderMutation.isPending
  ) {
    setPrevGroupedByProvider(groupedByProvider);
    setLocalSshConnections(groupedByProvider.sftp);
    setLocalS3Connections(groupedByProvider.s3);
  }

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
      // Magnetic snap to the default mid-width when the cursor is within
      // ±SNAP_PX of it — gives the resize a perceptible "click" instead of
      // sliding through unbounded values, without needing a separate "reset"
      // affordance.
      const SNAP_TARGETS = [220, 260, 320];
      const SNAP_PX = 8;
      const onMouseMove = (e: MouseEvent) => {
        let width = Math.max(200, Math.min(400, e.clientX));
        for (const t of SNAP_TARGETS) {
          if (Math.abs(width - t) <= SNAP_PX) {
            width = t;
            break;
          }
        }
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleShowHiddenConnections()}
                className={cn(
                  'btn-icon !p-1',
                  showHiddenConnections ? 'text-primary' : 'text-muted-foreground/50',
                )}
                title={
                  showHiddenConnections
                    ? 'Hide background connections'
                    : 'Show background connections'
                }
                aria-label={
                  showHiddenConnections
                    ? 'Hide background connections'
                    : 'Show background connections'
                }
              >
                {showHiddenConnections ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => openCreateForm()}
                className="btn-icon !p-1"
                title="New connection"
                aria-label="New connection"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
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
                  value={searchInputValue}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                  placeholder="Filter connections..."
                  aria-label="Filter connections"
                  className="form-input !py-1 !pl-7 !pr-7 !text-xs"
                />
                {searchInputValue && (
                  <button
                    onClick={() => setSearchInputValue('')}
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
                  {debouncedSearchQuery ? 'No matching connections' : 'No connections yet'}
                </p>
                {!debouncedSearchQuery && (
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
                {sidebarSectionOrder.map((sectionId) => (
                  <SidebarSection
                    key={sectionId}
                    sectionId={sectionId as 'ssh' | 's3'}
                    groupedByProvider={groupedByProvider}
                    localSshConnections={localSshConnections}
                    setLocalSshConnections={setLocalSshConnections}
                    localS3Connections={localS3Connections}
                    setLocalS3Connections={setLocalS3Connections}
                    setIsDraggingConnection={setIsDraggingConnection}
                    draggingSection={draggingSection}
                    setDraggingSection={setDraggingSection}
                    reorderMutation={reorderMutation}
                  />
                ))}
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

function SidebarSection({
  sectionId,
  groupedByProvider,
  localSshConnections,
  setLocalSshConnections,
  localS3Connections,
  setLocalS3Connections,
  setIsDraggingConnection,
  draggingSection,
  setDraggingSection,
  reorderMutation,
}: {
  sectionId: 'ssh' | 's3';
  groupedByProvider: { sftp: Connection[]; s3: Connection[] };
  localSshConnections: Connection[];
  setLocalSshConnections: (v: Connection[]) => void;
  localS3Connections: Connection[];
  setLocalS3Connections: (v: Connection[]) => void;
  setIsDraggingConnection: (v: boolean) => void;
  draggingSection: string | null;
  setDraggingSection: (v: string | null) => void;
  reorderMutation: UseMutationResult<void, Error, string[], unknown>;
}) {
  const controls = useDragControls();
  const isSsh = sectionId === 'ssh';
  const connections = isSsh ? localSshConnections : localS3Connections;
  const setConnections = isSsh ? setLocalSshConnections : setLocalS3Connections;
  const hasConnections = isSsh
    ? groupedByProvider.sftp.length > 0
    : groupedByProvider.s3.length > 0;

  // Hooks must run in the same order every render — group/sort *before*
  // the early return so React's hook accounting stays stable when a
  // section transitions empty ↔ non-empty.
  const folders = useMemo(() => {
    const groups: Record<string, Connection[]> = {};
    for (const conn of connections) {
      const folder = conn.folder || 'default';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(conn);
    }
    return groups;
  }, [connections]);

  const sortedFolderNames = useMemo(() => {
    return Object.keys(folders).sort((a, b) => {
      if (a === 'default') return 1;
      if (b === 'default') return -1;
      return a.localeCompare(b);
    });
  }, [folders]);

  if (!hasConnections) return null;

  const handleReorderFolder = (folderName: string, newOrder: Connection[]) => {
    // Find the range in the original connections array and replace it
    const folderItems = folders[folderName];
    if (!folderItems) return;

    // Preserve the relative order of items in other folders while updating this one
    const updatedConnections = [...connections];
    const firstIndex = connections.findIndex((c) => (c.folder || 'default') === folderName);

    if (firstIndex !== -1) {
      updatedConnections.splice(firstIndex, folderItems.length, ...newOrder);
      setConnections(updatedConnections);
    }
  };

  return (
    <Reorder.Item
      value={sectionId}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDraggingSection(sectionId)}
      onDragEnd={() => setTimeout(() => setDraggingSection(null), 100)}
      className="space-y-1 bg-sidebar"
    >
      <div
        onPointerDown={(e) => controls.start(e)}
        className="flex items-center justify-between px-2.5 pb-1 cursor-grab active:cursor-grabbing group/section"
      >
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 group-hover/section:text-muted-foreground/80 transition-colors">
          {isSsh ? <Terminal className="h-3 w-3" /> : <FolderClosed className="h-3 w-3" />}
          <span>{isSsh ? 'SSH Sessions' : 'S3 Storage'}</span>
        </div>
        <GripVertical className="h-3 w-3 text-muted-foreground/20 opacity-0 group-hover/section:opacity-100 transition-opacity" />
      </div>

      <div className="space-y-1">
        {sortedFolderNames.map((folderName) => (
          <FolderGroup
            key={folderName}
            name={folderName}
            connections={folders[folderName]}
            onReorder={(newOrder) => handleReorderFolder(folderName, newOrder)}
            setIsDraggingConnection={setIsDraggingConnection}
            draggingSection={draggingSection}
            reorderMutation={reorderMutation}
            allConnectionsInSection={connections}
          />
        ))}
      </div>
    </Reorder.Item>
  );
}

function FolderGroup({
  name,
  connections,
  onReorder,
  setIsDraggingConnection,
  draggingSection,
  reorderMutation,
  allConnectionsInSection,
}: {
  name: string;
  connections: Connection[];
  onReorder: (newOrder: Connection[]) => void;
  setIsDraggingConnection: (v: boolean) => void;
  draggingSection: string | null;
  reorderMutation: UseMutationResult<void, Error, string[], unknown>;
  allConnectionsInSection: Connection[];
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isDefault = name === 'default';

  return (
    <div className="space-y-0.5">
      {!isDefault && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="group/folder flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 text-muted-foreground/30 group-hover/folder:text-muted-foreground/60 transition-transform',
              isOpen && 'rotate-90',
            )}
          />
          <FolderClosed className="h-3 w-3 text-muted-foreground/40 group-hover/folder:text-muted-foreground/70" />
          <span className="truncate">{name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/20 group-hover/folder:text-muted-foreground/50 tabular-nums">
            {connections.length}
          </span>
        </button>
      )}

      <AnimatePresence initial={false}>
        {(isDefault || isOpen) && (
          <motion.div
            initial={isDefault ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <Reorder.Group
              axis="y"
              values={connections}
              onReorder={onReorder}
              className={cn('space-y-0.5', !isDefault && 'pl-2 ml-3.5 border-l border-border/30')}
            >
              {connections.map((conn) => (
                <DraggableConnectionItem
                  key={conn.id}
                  connection={conn}
                  disabled={!!draggingSection}
                  onDragStart={() => setIsDraggingConnection(true)}
                  onDragEnd={() => {
                    setIsDraggingConnection(false);
                    reorderMutation.mutate(allConnectionsInSection.map((c) => c.id));
                  }}
                />
              ))}
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DraggableConnectionItem({
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

function ConnectionItem({
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
  const { activeConnectionId, setActiveConnectionId, openEditForm, openDuplicateForm } =
    useConnectionStore();
  const { setActiveView } = useUIStore();
  const { sessions } = useTerminalStore();
  const { data: allConnections } = useConnections();
  // The bastion may have been deleted (FK is ON DELETE SET NULL on the
  // server, but the renderer's cached row can briefly out-pace that) — fall
  // back to a generic "via jump host" label so the badge still signals the
  // chain even when the lookup misses.
  const jumpHostName = connection.jumpHostConnectionId
    ? allConnections?.find((c) => c.id === connection.jumpHostConnectionId)?.name
    : undefined;
  const storageSessions = useStorageStore((s) => s.storageSessions);
  const setActiveSessionId = useStorageStore((s) => s.setActiveSessionId);
  const deleteMutation = useDeleteConnection();
  const updateMutation = useUpdateConnection();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      useTerminalStore.getState().setActiveTab(existingSession.id);
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
          window.api.transfers?.cancelBySession?.(existing.id).catch(() => {});
          await window.api.s3.disconnect(existing.id);
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
        ? Array.from(useStorageStore.getState().storageSessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id
        : Array.from(useTerminalStore.getState().sessions.values()).find(
            (s) => s.connectionId === connection.id,
          )?.id;

      if (sessionId) {
        window.api.transfers?.cancelBySession?.(sessionId).catch(() => {});
        if (isS3) {
          await window.api.s3.disconnect(sessionId);
          useStorageStore.getState().removeStorageSession(sessionId);
        } else {
          void window.api.ssh.disconnect(sessionId);
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
      label: connection.isHidden ? 'Show in Sidebar' : 'Hide from Sidebar',
      icon: connection.isHidden ? (
        <Eye className="h-3.5 w-3.5" />
      ) : (
        <EyeOff className="h-3.5 w-3.5" />
      ),
      onClick: () => {
        updateMutation.mutate({
          id: connection.id,
          isHidden: !connection.isHidden,
        });
      },
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
            'group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left cursor-pointer transition-colors',
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
                    {connection.jumpHostConnectionId && (
                      <span
                        className="ml-1.5 inline-flex items-center rounded border border-border/50 bg-muted/40 px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground/80"
                        title={`Tunneled via jump host${jumpHostName ? ` "${jumpHostName}"` : ''}`}
                      >
                        via {jumpHostName ?? 'jump'}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <ChevronRight
            aria-hidden="true"
            className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/70 flex-shrink-0 transition-colors"
          />
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              dragControls.start(e);
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing px-1 py-2 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <GripVertical className="h-3 w-3 text-muted-foreground/40" />
          </div>
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
}
