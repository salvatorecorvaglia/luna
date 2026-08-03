import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnections, useReorderConnections } from '@/hooks/use-connections';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/stores/connection-store';
import { useUIStore } from '@/stores/ui-store';
import {
  SidebarEmptyState,
  SidebarHeader,
  SidebarSearch,
  SidebarSection,
  SidebarSkeleton,
} from './sidebar-parts';

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
    // Filter out hidden connections from the sidebar
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

  // Mirror the grouped query result into local state so optimistic drag-reorder
  // can mutate without waiting for the mutation round-trip. Uses the
  // render-time setState pattern from the React docs ("Adjusting state on a
  // prop change") instead of useEffect — running in the render phase lets
  // React batch the update into the same commit, avoiding the extra paint
  // that an effect-driven sync would cause.
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
          <SidebarHeader
            showHiddenConnections={showHiddenConnections}
            onToggleHidden={toggleShowHiddenConnections}
            onNewConnection={openCreateForm}
          />

          {connectionList.length > 0 && (
            <SidebarSearch value={searchInputValue} onChange={setSearchInputValue} />
          )}

          {/* Connection List */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {isLoading ? (
              <SidebarSkeleton />
            ) : filteredConnections.length === 0 ? (
              <SidebarEmptyState hasQuery={!!debouncedSearchQuery} onCreate={openCreateForm} />
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
              <Settings className="size-3.5" />
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
