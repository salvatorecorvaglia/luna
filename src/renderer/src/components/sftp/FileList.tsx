import { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate, formatSize } from '@/lib/format';
import type { FileEntry } from '@shared/types/sftp';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';

type SortField = 'name' | 'size' | 'modifiedAt';
type SortDir = 'asc' | 'desc';

interface FileListProps {
  entries: FileEntry[];
  selection: Set<string>;
  onSelect: (name: string) => void;
  onOpen: (entry: FileEntry) => void;
  onDragStart?: (entry: FileEntry, e: React.DragEvent) => void;
  onRename?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
  onPreview?: (entry: FileEntry) => void;
  showPermissions?: boolean;
  onSelectAll?: () => void;
  emptyMessage?: string;
}

function getFileIcon(entry: FileEntry) {
  if (entry.isDirectory) return <Folder className="h-4 w-4 text-info" aria-hidden="true" />;
  if (entry.isSymlink) return <Link2 className="h-4 w-4 text-cyan-500" aria-hidden="true" />;

  const ext = entry.name.split('.').pop()?.toLowerCase();

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext || ''))
    return <FileImage className="h-4 w-4 text-pink-500" aria-hidden="true" />;
  if (
    [
      'js',
      'ts',
      'jsx',
      'tsx',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'sh',
      'bash',
    ].includes(ext || '')
  )
    return <FileCode className="h-4 w-4 text-success" aria-hidden="true" />;
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext || ''))
    return <FileArchive className="h-4 w-4 text-warning" aria-hidden="true" />;
  if (
    [
      'md',
      'txt',
      'log',
      'csv',
      'json',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'cfg',
      'conf',
    ].includes(ext || '')
  )
    return <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;

  return <File className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

export function FileList({
  entries,
  selection,
  onSelect,
  onOpen,
  onDragStart,
  onRename,
  onDelete,
  onCopyPath,
  onPreview,
  showPermissions = false,
  onSelectAll,
  emptyMessage = 'No files',
}: FileListProps) {
  'use no memo';
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'name') return mul * a.name.localeCompare(b.name);
      if (sortField === 'size') return mul * (a.size - b.size);
      return mul * (a.modifiedAt - b.modifiedAt);
    });
  }, [entries, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );
  };

  const ROW_HEIGHT = 32;
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- opted out of memoization via "use no memo"
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Build a per-entry ContextMenuItem array once per (entry, callback)
  // tuple. Without this, every render of a 1000-entry list allocated 1000
  // fresh arrays even when nothing changed. The callbacks are stable refs
  // from the parent, so the memo only invalidates when the parent rebinds.
  const buildContextItems = useCallback(
    (entry: FileEntry): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      if (!entry.isDirectory && onPreview) {
        items.push({
          label: 'Preview',
          icon: <Eye className="h-3.5 w-3.5" />,
          onClick: () => onPreview(entry),
        });
      }
      if (onCopyPath) {
        items.push({
          label: 'Copy Path',
          icon: <Copy className="h-3.5 w-3.5" />,
          onClick: () => onCopyPath(entry),
        });
      }
      if (onRename) {
        items.push({
          label: 'Rename',
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => onRename(entry),
          separator: true,
        });
      }
      if (onDelete) {
        items.push({
          label: 'Delete',
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onClick: () => onDelete(entry),
          destructive: true,
        });
      }
      return items;
    },
    [onPreview, onCopyPath, onRename, onDelete],
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sorted.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, sorted.length - 1);
          setFocusedIndex(next);
          onSelect(sorted[next].name);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          onSelect(sorted[prev].name);
          virtualizer.scrollToIndex(prev, { align: 'auto' });
          break;
        }
        case 'Enter': {
          if (focusedIndex >= 0 && focusedIndex < sorted.length) {
            onOpen(sorted[focusedIndex]);
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (focusedIndex >= 0 && focusedIndex < sorted.length && onDelete) {
            onDelete(sorted[focusedIndex]);
          }
          break;
        }
        case 'a': {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onSelectAll?.();
          }
          break;
        }
      }
    },
    [sorted, focusedIndex, onSelect, onOpen, onDelete, onSelectAll, virtualizer],
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FolderOpen className="h-8 w-8 text-muted-foreground/20" />
        <span className="text-xs">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={handleListKeyDown}
      role="listbox"
      aria-label="File list"
      aria-multiselectable="true"
    >
      {/* Header */}
      <div className="flex items-center border-b border-border/60 bg-muted/20 text-[11px] font-medium text-muted-foreground/80 no-select">
        <button
          onClick={() => handleSort('name')}
          className="flex flex-1 items-center gap-1 px-3 py-1.5 hover:text-foreground cursor-pointer"
        >
          Name <SortIcon field="name" />
        </button>
        <button
          onClick={() => handleSort('size')}
          className="flex w-20 items-center justify-end gap-1 px-2 py-1.5 hover:text-foreground cursor-pointer"
        >
          Size <SortIcon field="size" />
        </button>
        {showPermissions && <div className="w-[84px] px-2 py-1.5 text-right">Perms</div>}
        <button
          onClick={() => handleSort('modifiedAt')}
          className="flex w-36 items-center justify-end gap-1 px-3 py-1.5 hover:text-foreground cursor-pointer"
        >
          Modified <SortIcon field="modifiedAt" />
        </button>
      </div>

      {/* Virtualized file rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = sorted[virtualRow.index];
            const contextItems = buildContextItems(entry);
            const row = (
              <div
                key={entry.path}
                role="option"
                tabIndex={focusedIndex === virtualRow.index ? 0 : -1}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                aria-selected={selection.has(entry.name)}
                className={cn(
                  'group flex items-center text-xs cursor-pointer border-b border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selection.has(entry.name)
                    ? 'bg-accent/80 border-b-border/30'
                    : 'hover:bg-accent/30',
                  focusedIndex === virtualRow.index && 'ring-1 ring-inset ring-ring/50',
                )}
                onClick={() => {
                  setFocusedIndex(virtualRow.index);
                  onSelect(entry.name);
                }}
                onDoubleClick={() => onOpen(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(entry);
                  if (e.key === ' ') {
                    e.preventDefault();
                    onSelect(entry.name);
                  }
                }}
                draggable={!!onDragStart}
                onDragStart={(e) => onDragStart?.(entry, e)}
              >
                <div className="flex flex-1 items-center gap-2 truncate px-3 py-[7px]">
                  {getFileIcon(entry)}
                  <span className={cn('truncate', entry.isDirectory && 'font-medium')}>
                    {entry.name}
                  </span>
                </div>
                <div className="w-20 px-2 py-[7px] text-right text-muted-foreground/70 tabular-nums">
                  {entry.isDirectory ? '\u2014' : formatSize(entry.size)}
                </div>
                {showPermissions && (
                  <div className="w-[84px] px-2 py-[7px] text-right font-mono text-[10px] text-muted-foreground/70">
                    {entry.permissions || '\u2014'}
                  </div>
                )}
                <div className="w-36 px-3 py-[7px] text-right text-muted-foreground/70 tabular-nums">
                  {formatDate(entry.modifiedAt)}
                </div>
              </div>
            );
            return contextItems.length > 0 ? (
              <ContextMenu key={entry.path} items={contextItems}>
                {row}
              </ContextMenu>
            ) : (
              row
            );
          })}
        </div>
      </div>
    </div>
  );
}
