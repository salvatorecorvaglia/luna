import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Home,
  RefreshCw,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  Search,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileList } from './FileList'
import type { FileEntry } from '@shared/types/sftp'

export type { FileEntry }

interface FilePaneProps {
  title: string
  path: string
  entries: FileEntry[]
  isLoading: boolean
  error: Error | null
  selection: Set<string>
  onPathChange: (path: string) => void
  onSelect: (name: string) => void
  onRefresh: () => void
  onDragStart?: (entry: FileEntry, e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onFileOpen?: (entry: FileEntry) => void
  onRename?: (entry: FileEntry) => void
  onDelete?: (entry: FileEntry) => void
  onCopyPath?: (entry: FileEntry) => void
  onPreview?: (entry: FileEntry) => void
  showHidden?: boolean
  onToggleHidden?: () => void
  onMkdir?: () => void
  onSelectAll?: () => void
  side: 'local' | 'remote'
}

function splitBreadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  const crumbs = [{ name: '/', path: '/' }]

  let current = ''
  for (const part of parts) {
    current += '/' + part
    crumbs.push({ name: part, path: current })
  }

  return crumbs
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
  showHidden = true,
  onToggleHidden,
  onMkdir,
  onSelectAll,
  side
}: FilePaneProps) {
  const breadcrumbs = useMemo(() => splitBreadcrumbs(path), [path])
  const [dragOver, setDragOver] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [prevPath, setPrevPath] = useState(path)
  const filterInputRef = useRef<HTMLInputElement>(null)

  if (prevPath !== path) {
    setPrevPath(path)
    if (filterQuery) setFilterQuery('')
    if (filterOpen) setFilterOpen(false)
  }

  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus()
  }, [filterOpen])

  const visibleEntries = useMemo(() => {
    let list = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
    const q = filterQuery.trim().toLowerCase()
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q))
    return list
  }, [entries, showHidden, filterQuery])

  const navigateUp = useCallback(() => {
    const parent = path.split('/').slice(0, -1).join('/') || '/'
    onPathChange(parent)
  }, [path, onPathChange])

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path)
      } else {
        onFileOpen?.(entry)
      }
    },
    [onPathChange, onFileOpen]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragOver(false)
      onDrop?.(e)
    },
    [onDrop]
  )

  const handlePaneKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFilterOpen(true)
      } else if (e.key === 'Escape' && filterOpen) {
        setFilterOpen(false)
        setFilterQuery('')
      }
    },
    [filterOpen, setFilterOpen, setFilterQuery]
  )

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden',
        dragOver && 'ring-2 ring-inset ring-primary/40 bg-primary/[0.02]'
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
              'inline-block h-2 w-2 rounded-full',
              side === 'local' ? 'bg-blue-500' : 'bg-emerald-500'
            )}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {onMkdir && (
            <button
              onClick={onMkdir}
              className="btn-icon !p-1"
              title="New folder"
              aria-label="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
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
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className={cn('btn-icon !p-1', filterOpen && 'text-foreground bg-accent')}
            title="Filter (⌘F)"
            aria-label="Filter files"
            aria-pressed={filterOpen}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button onClick={navigateUp} className="btn-icon !p-1" title="Go up" aria-label="Go up">
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={onRefresh}
            className="btn-icon !p-1"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/60 px-2.5 py-1 text-xs no-select">
        <button
          onClick={() => onPathChange('/')}
          className="flex-shrink-0 rounded p-0.5 text-muted-foreground/70 hover:text-foreground hover:bg-accent cursor-pointer"
          title="Root"
        >
          <Home className="h-3 w-3" />
        </button>
        {breadcrumbs.slice(1).map((crumb) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
            <button
              onClick={() => onPathChange(crumb.path)}
              className="truncate text-muted-foreground/70 hover:text-foreground max-w-[120px] cursor-pointer"
              title={crumb.path}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Filter */}
      {filterOpen && (
        <div className="border-b border-border/60 bg-muted/10 px-2 py-1.5">
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50"
              aria-hidden="true"
            />
            <input
              ref={filterInputRef}
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter files..."
              aria-label="Filter files in current directory"
              className="form-input !py-1 !pl-7 !pr-7 !text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilterOpen(false)
                  setFilterQuery('')
                }
              }}
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/50 hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-3 w-3" aria-hidden="true" />
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
            className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center"
          >
            <span className="text-xs font-medium text-destructive">
              {error.message || 'Failed to load directory'}
            </span>
            <button
              onClick={onRefresh}
              className="text-xs text-muted-foreground hover:text-foreground cursor-pointer underline"
            >
              Try again
            </button>
          </div>
        ) : isLoading && entries.length === 0 ? (
          <FilePaneSkeleton showPermissions={side === 'remote'} />
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
            showPermissions={side === 'remote'}
            onSelectAll={onSelectAll}
            emptyMessage={filterQuery ? `No files match "${filterQuery}"` : 'Empty directory'}
          />
        )}
      </div>
    </div>
  )
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
              <div className="skeleton h-4 w-4 rounded-sm" />
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
  )
}
