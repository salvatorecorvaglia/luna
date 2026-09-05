import type { FileEntry } from '@shared/types/sftp';
import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  FolderSync,
  Home,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '@/components/ui';
import { MOD_KEY } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useStorageStore } from '@/stores/storage-store';
import { FileList } from './FileList';

export type { FileEntry };

/**
 * Pressed state for the filter toggle.
 *
 * `!`-prefixed because `.btn-icon` is declared outside Tailwind's `@layer`
 * blocks in assets/main.css and therefore beats every utility class — the
 * unprefixed `text-foreground bg-accent` that used to sit here never applied.
 */
const ACTIVE_TOGGLE = '!text-foreground !bg-accent';

interface FilePaneProps {
  title: string;
  path: string;
  entries: FileEntry[];
  isLoading: boolean;
  error: Error | null;
  selection: Set<string>;
  onPathChange: (path: string) => void;
  onSelect: (selection: Set<string>) => void;
  onRefresh: () => void;
  onDragStart?: (entry: FileEntry, e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onFileOpen?: (entry: FileEntry) => void;
  onRename?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
  onPreview?: (entry: FileEntry) => void;
  onDownload?: (entry: FileEntry) => void;
  onGeneratePresignedUrl?: (entry: FileEntry) => void;
  downloadLabel?: string;
  showHidden?: boolean;
  onToggleHidden?: () => void;
  onMkdir?: () => void;
  onFolderSync?: () => void;
  onSelectAll?: (names: string[]) => void;
  side: 'local' | 'remote';
  /**
   * For remote panes, identifies the backing storage kind so the pane can hide
   * affordances that don't apply (e.g. POSIX permissions on S3 objects).
   */
  remoteKind?: 'sftp' | 's3';
  /**
   * Highest directory this pane may navigate to. Breadcrumbs start here, the
   * home button returns here, and "go up" stops here.
   *
   * Defaults to `'/'` so remote panes are unaffected. Local panes must pass the
   * user's home directory: `shell:readdir` refuses to list anything outside the
   * home subtree, so offering `/` (or any ancestor of home) put the pane into a
   * state where every control it still rendered returned "Access denied".
   */
  rootPath?: string;
}

/** Strip the trailing slash so `/a/b/` and `/a/b` compare equal. Root becomes `''`. */
function normalizeDir(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

/**
 * Breadcrumb segments *below* `rootPath` — the root itself is rendered as the
 * home button, so it never appears as a crumb.
 *
 * A path outside the root can still arrive here from a persisted store value
 * written by an older build. Rather than render nothing, fall back to absolute
 * crumbs so the user can at least see where they are.
 */
function splitBreadcrumbs(path: string, rootPath: string): { name: string; path: string }[] {
  const root = normalizeDir(rootPath);
  const current = normalizeDir(path);
  const inRoot = current === root || current.startsWith(root + '/');
  const base = inRoot ? root : '';

  const crumbs: { name: string; path: string }[] = [];
  let acc = base;
  for (const part of current.slice(base.length).split('/').filter(Boolean)) {
    acc = `${acc}/${part}`;
    crumbs.push({ name: part, path: acc });
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
  onGeneratePresignedUrl,
  downloadLabel,
  showHidden = true,
  onToggleHidden,
  onMkdir,
  onFolderSync,
  onSelectAll,
  side,
  remoteKind,
  rootPath = '/',
}: FilePaneProps) {
  const activeSessionId = useStorageStore((s) => s.activeSessionId);
  const isTruncated = useStorageStore((s) =>
    activeSessionId ? s.truncatedPaths.has(`${activeSessionId}\0${path}`) : false,
  );

  // Unix permissions don't exist on S3 objects, and `shell:readdir` never
  // populates them for local entries — so only SFTP remote panes have a
  // permissions column to show. Local panes rendered an 84px column of em
  // dashes before this narrowed.
  const showPermissions = side === 'remote' && remoteKind !== 's3';
  const breadcrumbs = useMemo(() => splitBreadcrumbs(path, rootPath), [path, rootPath]);
  const atRoot = normalizeDir(path) === normalizeDir(rootPath);
  // Derived from `rootPath`, not `side`: a pane rooted at `/` really is showing
  // the root directory. The only non-`/` root in the app is the local pane's
  // home jail (see the rootPath prop doc).
  const rootLabel = normalizeDir(rootPath) === '' ? 'root directory' : 'home folder';
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
    // Never step above the pane's root. The button is disabled at the root, so
    // this is the guard for a path that arrived from outside it.
    const root = normalizeDir(rootPath);
    const next = normalizeDir(parent);
    const withinRoot = root === '' || next === root || next.startsWith(root + '/');
    onPathChange(withinRoot ? parent : rootPath);
  }, [path, rootPath, onPathChange]);

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

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // dragleave fires as the cursor crosses into a *child* row, so clearing
    // unconditionally made the drop-target highlight flicker across the whole
    // pane. Only clear when the pointer has actually left this element's
    // subtree. relatedTarget is null when leaving the window entirely.
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
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
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
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
            <IconButton
              onClick={onMkdir}
              title="New folder"
              aria-label="New folder"
              icon={<FolderPlus className="size-3.5" />}
            />
          )}
          {onFolderSync && (
            <IconButton
              onClick={onFolderSync}
              className="!text-primary"
              title="Sync Folders"
              aria-label="Sync Folders"
              icon={<FolderSync className="size-3.5" />}
            />
          )}
          {onToggleHidden && (
            <IconButton
              onClick={onToggleHidden}
              title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
              aria-label={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
              icon={showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            />
          )}

          <IconButton
            onClick={toggleFilter}
            className={cn(filterOpen && ACTIVE_TOGGLE)}
            title={`Filter (${MOD_KEY}F)`}
            aria-label="Filter files"
            aria-pressed={filterOpen}
            icon={<Search className="size-3.5" />}
          />

          <IconButton
            onClick={navigateUp}
            disabled={atRoot}
            title={atRoot ? `Already at the ${rootLabel}` : 'Go up'}
            aria-label="Go up"
            icon={<ArrowUp className="size-3.5" />}
          />

          <IconButton
            onClick={onRefresh}
            title="Refresh"
            aria-label="Refresh"
            icon={<RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />}
          />
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
            type="button"
            onClick={() => onPathChange(rootPath)}
            className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
            title={rootLabel.charAt(0).toUpperCase() + rootLabel.slice(1)}
            aria-label={`Navigate to ${rootLabel}`}
          >
            <Home className="size-3" />
          </button>
          {breadcrumbs.map((crumb, idx, arr) => {
            const isCurrent = idx === arr.length - 1;
            return (
              <span key={crumb.path} className="flex items-center gap-0.5">
                <ChevronRight
                  className="size-3 text-muted-foreground/60 flex-shrink-0"
                  aria-hidden="true"
                />

                <button
                  type="button"
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

      {side === 'remote' && isTruncated && (
        <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning/90 no-select">
          <ShieldAlert className="size-4 flex-shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1">
            <span className="font-semibold text-warning">List Truncated:</span> This folder contains
            more items than the display safety limit. Please create or navigate into a subfolder to
            view all items.
          </div>
        </div>
      )}

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
                type="button"
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
            <span className="max-w-[280px] text-xs font-medium text-destructive-fg/90 leading-relaxed">
              {error.message
                .replace(/^S3StorageError:\s*/i, '')
                .replace(/^SftpStorageError:\s*/i, '')
                .replace(/^Error:\s*/i, '') || 'Failed to load directory'}
            </span>

            <button
              type="button"
              onClick={onRefresh}
              className="mt-2 rounded-full bg-accent px-4 py-1.5 text-2xs font-semibold text-accent-foreground hover:bg-accent/80 transition-colors"
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
            onGeneratePresignedUrl={onGeneratePresignedUrl}
            downloadLabel={downloadLabel}
            showPermissions={showPermissions}
            onSelectAll={onSelectAll}
            emptyMessage={filterQuery ? `No files match "${filterQuery}"` : 'Empty directory'}
            remoteKind={remoteKind}
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
      <div className="flex items-center border-b border-border/60 bg-muted/20 text-2xs font-medium text-muted-foreground/60 no-select">
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
