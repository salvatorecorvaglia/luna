import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  Home,
  Loader2,
  RefreshCw,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileList } from './FileList';
import type { FileEntry } from '@shared/types/sftp';

export type { FileEntry };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

interface FilePaneProps {
  title: string;
  path: string;
  entries: FileEntry[];
  isLoading: boolean;
  error: Error | null;
  selection: Set<string>;
  onPathChange: (path: string) => void;
  onSelect: (name: string, multi?: boolean, range?: boolean) => void;
  onRefresh: () => void;
  onDragStart?: (entry: FileEntry, e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onFileOpen?: (entry: FileEntry) => void;
  onRename?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
  onPreview?: (entry: FileEntry) => void;
  onDownload?: (entry: FileEntry) => void;
  downloadLabel?: string;
  showHidden?: boolean;
  onToggleHidden?: () => void;
  onMkdir?: () => void;
  onSelectAll?: () => void;
  side: 'local' | 'remote';
  /**
   * For remote panes, identifies the backing storage kind so the pane can hide
   * affordances that don't apply (e.g. POSIX permissions on S3 objects).
   * Local panes ignore this — they always show permissions on POSIX hosts.
   */
  remoteKind?: 'sftp' | 's3';
}

function splitBreadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean);
  const crumbs = [{ name: '/', path: '/' }];

  let current = '';
  for (const part of parts) {
    current += '/' + part;
    crumbs.push({ name: part, path: current });
  }

  return crumbs;
}

export function FilePane({
  title,
  path,
  entries,
  isLoading,
  error,
  selection,
  onPathChange,
  onSelect,
  onRefresh,
  onDragStart,
  onDrop,
  onFileOpen,
  onRename,
  onDelete,
  onCopyPath,
  onPreview,
  onDownload,
  downloadLabel,
  showHidden = true,
  onToggleHidden,
  onMkdir,
  onSelectAll,
  side,
  remoteKind,
}: FilePaneProps) {
  // Unix permissions don't exist on S3 objects, so the perms column is
  // suppressed there. Local panes and SFTP remote panes show it.
  const showPermissions = side === 'remote' ? remoteKind !== 's3' : true;
  const breadcrumbs = useMemo(() => splitBreadcrumbs(path), [path]);
  const [dragOver, setDragOver] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [prevPath, setPrevPath] = useState(path);
  const filterInputRef = useRef<HTMLInputElement>(null);

  if (prevPath !== path) {
    setPrevPath(path);
    // Clear the filter query on navigation but keep the input open so a user
    // browsing rapidly through subdirectories doesn't have to re-trigger the
    // filter UI on every step.
    if (filterQuery) setFilterQuery('');
  }

  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus();
  }, [filterOpen]);

  /**
   * Toggle the filter input visibility, dropping any stale query when the
   * UI is dismissed. Without the explicit clear, a user returning to the
   * pane later would find the list partially filtered with no visible chip
   * indicating why their file is "missing".
   */
  const toggleFilter = useCallback(() => {
    setFilterOpen((prev) => {
      if (prev) setFilterQuery('');
      return !prev;
    });
  }, []);

  // useDeferredValue defers the heavy filter pass on the previous query so
  // typing in a 10k-file pane doesn't block keystroke commits. React keeps
  // the old filtered list visible until the new pass is ready.
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const visibleEntries = useMemo(() => {
    let list = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
    const q = deferredFilterQuery.trim().toLowerCase();
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
    return list;
  }, [entries, showHidden, deferredFilterQuery]);

  const navigateUp = useCallback(() => {
    const parent = path.split('/').slice(0, -1).join('/') || '/';
    onPathChange(parent);
  }, [path, onPathChange]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path);
      } else {
        onFileOpen?.(entry);
      }
    },
    [onPathChange, onFileOpen],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragOver(false);
      onDrop?.(e);
    },
    [onDrop],
  );

  const handlePaneKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFilterOpen(true);
      } else if (e.key === 'Escape' && filterOpen) {
        setFilterOpen(false);
        setFilterQuery('');
      }
    },
    [filterOpen, setFilterOpen, setFilterQuery],
  );

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden',
        dragOver && 'ring-2 ring-inset ring-primary/40 bg-primary/[0.02]',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={handlePaneKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-2.5 py-1.5 no-select">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block size-2 rounded-full',
              side === 'local' ? 'bg-info' : 'bg-success',
            )}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          {/* Surface in-flight loads in the header so an empty list isn't
              ambiguous between "no entries" and "still fetching". */}
          {isLoading && (
            <Loader2
              className="size-3 animate-spin text-muted-foreground/70"
              aria-label="Loading directory"
              role="status"
            />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {onMkdir && (
            <button
              onClick={onMkdir}
              className="btn-icon !p-1"
              title="New folder"
              aria-label="New folder"
            >
              <FolderPlus className="size-3.5" aria-hidden="true" />
            </button>
          )}
          {onToggleHidden && (
            <button
              onClick={onToggleHidden}
              className="btn-icon !p-1"
              title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
              aria-label={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
            >
              {showHidden ? (
                <Eye className="size-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="size-3.5" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            onClick={toggleFilter}
            className={cn('btn-icon !p-1', filterOpen && 'text-foreground bg-accent')}
            title={`Filter (${MOD}F)`}
            aria-label="Filter files"
            aria-pressed={filterOpen}
          >
            <Search className="size-3.5" aria-hidden="true" />
          </button>
          <button onClick={navigateUp} className="btn-icon !p-1" title="Go up" aria-label="Go up">
            <ArrowUp className="size-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={onRefresh}
            className="btn-icon !p-1"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Breadcrumbs — use a CSS mask so the fade only affects opacity at
          the very edges (8px) and never paints a solid color over the
          text. This preserves the scroll affordance without obscuring
          characters that sit near the edge. */}
      <div className="relative border-b border-border/60">
        <div
          className="flex items-center gap-0.5 overflow-x-auto px-2.5 py-1 text-xs no-select scrollbar-none"
          style={{
            maskImage:
              'linear-gradient(to right, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%)',
          }}
        >
          <button
            onClick={() => onPathChange('/')}
            className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
            title="Root"
            aria-label="Navigate to root directory"
          >
            <Home className="size-3" />
          </button>
          {breadcrumbs.slice(1).map((crumb, idx, arr) => {
            const isCurrent = idx === arr.length - 1;
            return (
              <span key={crumb.path} className="flex items-center gap-0.5">
                <ChevronRight
                  className="size-3 text-muted-foreground/60 flex-shrink-0"
                  aria-hidden="true"
                />
                <button
                  onClick={() => onPathChange(crumb.path)}
                  className="truncate text-muted-foreground hover:text-foreground max-w-[120px] cursor-pointer"
                  title={crumb.path}
                  aria-label={`Navigate to ${crumb.path}`}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {crumb.name}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Filter */}
      {filterOpen && (
        <div className="border-b border-border/60 bg-muted/10 px-2 py-1.5">
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50"
              aria-hidden="true"
            />
            <input
              ref={filterInputRef}
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter files..."
              aria-label="Filter files in current directory"
              className="form-input !py-1 !pl-7 !pr-7"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilterOpen(false);
                  setFilterQuery('');
                }
              }}
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="input-clear-btn"
                aria-label="Clear filter"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-hidden">
        {error ? (
          <div
            role="alert"
            aria-live="polite"
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <WifiOff className="size-8 text-muted-foreground/30" aria-hidden="true" />
            <span className="max-w-[280px] text-xs font-medium text-destructive/90 leading-relaxed">
              {error.message
                .replace(/^S3StorageError:\s*/i, '')
                .replace(/^SftpStorageError:\s*/i, '')
                .replace(/^Error:\s*/i, '') || 'Failed to load directory'}
            </span>
            <button
              onClick={onRefresh}
              className="mt-2 rounded-full bg-accent px-4 py-1.5 text-[11px] font-semibold text-accent-foreground hover:bg-accent/80 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : isLoading && entries.length === 0 ? (
          <FilePaneSkeleton showPermissions={showPermissions} />
        ) : (
          <FileList
            entries={visibleEntries}
            selection={selection}
            onSelect={onSelect}
            onOpen={handleOpen}
            onDragStart={onDragStart}
            onRename={onRename}
            onDelete={onDelete}
            onCopyPath={onCopyPath}
            onPreview={onPreview}
            onDownload={onDownload}
            downloadLabel={downloadLabel}
            showPermissions={showPermissions}
            onSelectAll={onSelectAll}
            emptyMessage={filterQuery ? `No files match "${filterQuery}"` : 'Empty directory'}
          />
        )}
      </div>
    </div>
  );
}

function FilePaneSkeleton({ showPermissions }: { showPermissions: boolean }) {
  return (
    <div
      className="flex h-full flex-col"
      role="status"
      aria-live="polite"
      aria-label="Loading directory"
    >
      <div className="flex items-center border-b border-border/60 bg-muted/20 text-[11px] font-medium text-muted-foreground/60 no-select">
        <div className="flex flex-1 items-center px-3 py-1.5">Name</div>
        <div className="w-20 px-2 py-1.5 text-right">Size</div>
        {showPermissions && <div className="w-[84px] px-2 py-1.5 text-right">Perms</div>}
        <div className="w-36 px-3 py-1.5 text-right">Modified</div>
      </div>
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex h-8 items-center border-b border-transparent">
            <div className="flex flex-1 items-center gap-2 px-3">
              <div className="skeleton size-4 rounded-sm" />
              <div className="skeleton h-3" style={{ width: `${40 + ((i * 13) % 40)}%` }} />
            </div>
            <div className="w-20 px-2 text-right">
              <div className="skeleton ml-auto h-3 w-10" />
            </div>
            {showPermissions && (
              <div className="w-[84px] px-2 text-right">
                <div className="skeleton ml-auto h-3 w-14" />
              </div>
            )}
            <div className="w-36 px-3 text-right">
              <div className="skeleton ml-auto h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading directory contents…</span>
    </div>
  );
}
