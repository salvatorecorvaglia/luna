import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
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
import { EmptyState } from '@/components/ui';

type SortField = 'name' | 'size' | 'modifiedAt';
type SortDir = 'asc' | 'desc';

interface FileListProps {
  entries: FileEntry[];
  selection: Set<string>;
  onSelect: (selection: Set<string>) => void;
  onOpen: (entry: FileEntry) => void;
  onDragStart?: (entry: FileEntry, e: React.DragEvent) => void;
  onRename?: (entry: FileEntry) => void;
  onDelete?: (entry: FileEntry) => void;
  onCopyPath?: (entry: FileEntry) => void;
  onPreview?: (entry: FileEntry) => void;
  onDownload?: (entry: FileEntry) => void;
  downloadLabel?: string;
  showPermissions?: boolean;
  onSelectAll?: () => void;
  emptyMessage?: string;
}

function getFileIcon(entry: FileEntry) {
  if (entry.isDirectory) return <Folder className="size-4 text-info" aria-hidden="true" />;
  if (entry.isSymlink) return <Link2 className="size-4 text-brand-cyan" aria-hidden="true" />;

  const ext = entry.name.split('.').pop()?.toLowerCase();

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext || ''))
    return <FileImage className="size-4 text-brand-pink" aria-hidden="true" />;
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
    return <FileCode className="size-4 text-success" aria-hidden="true" />;
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext || ''))
    return <FileArchive className="size-4 text-warning" aria-hidden="true" />;
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
    return <FileText className="size-4 text-muted-foreground" aria-hidden="true" />;

  return <File className="size-4 text-muted-foreground" aria-hidden="true" />;
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
  onDownload,
  downloadLabel,
  showPermissions = false,
  onSelectAll,
  emptyMessage = 'This directory is empty',
}: FileListProps) {
  // Opt out of React Compiler memoization for the whole component because
  // useVirtualizer's internal refs/effects are incompatible with auto-memo
  // (see comment at the useVirtualizer call below). The directive is also a
  // no-op without the compiler plugin — it exists primarily to silence the
  // compiler-aware lint rule on the virtualizer call site.
  'use no memo';
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [anchorIndex, setAnchorIndex] = useState(-1);

  // Reset focus/anchor when the entries change (e.g., navigated to a different directory)
  useEffect(() => {
    setFocusedIndex(-1);
    setAnchorIndex(-1);
  }, [entries]);

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
      <ChevronUp className="size-3" />
    ) : (
      <ChevronDown className="size-3" />
    );
  };

  const ROW_HEIGHT_ESTIMATE = 32;
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- opted out of memoization via "use no memo"
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const buildContextItems = useCallback(
    (entry: FileEntry): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      if (!entry.isDirectory && onPreview) {
        items.push({
          label: 'Preview',
          icon: <Eye className="size-3.5" />,
          onClick: () => onPreview(entry),
        });
      }
      if (!entry.isDirectory && onDownload) {
        items.push({
          label: downloadLabel || 'Download',
          icon: <Download className="size-3.5" />,
          onClick: () => onDownload(entry),
        });
      }
      if (onCopyPath) {
        items.push({
          label: 'Copy Path',
          icon: <Copy className="size-3.5" />,
          onClick: () => onCopyPath(entry),
        });
      }
      if (onRename) {
        items.push({
          label: 'Rename',
          icon: <Pencil className="size-3.5" />,
          onClick: () => onRename(entry),
          separator: true,
        });
      }
      if (onDelete) {
        items.push({
          label: 'Delete',
          icon: <Trash2 className="size-3.5" />,
          onClick: () => onDelete(entry),
          destructive: true,
        });
      }
      return items;
    },
    [onPreview, onCopyPath, onRename, onDelete, onDownload, downloadLabel],
  );

  const handleSelect = useCallback(
    (index: number, ctrlKey: boolean, shiftKey: boolean) => {
      if (index < 0 || index >= sorted.length) return;
      const entry = sorted[index];
      const name = entry.name;
      let newSelection: Set<string>;

      if (shiftKey && anchorIndex !== -1) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const rangeNames = sorted.slice(start, end + 1).map((e) => e.name);

        if (ctrlKey) {
          newSelection = new Set(selection);
          for (const n of rangeNames) {
            newSelection.add(n);
          }
        } else {
          newSelection = new Set(rangeNames);
        }
        setFocusedIndex(index);
      } else if (ctrlKey) {
        newSelection = new Set(selection);
        if (newSelection.has(name)) {
          newSelection.delete(name);
        } else {
          newSelection.add(name);
        }
        setFocusedIndex(index);
        setAnchorIndex(index);
      } else {
        newSelection = new Set([name]);
        setFocusedIndex(index);
        setAnchorIndex(index);
      }

      onSelect(newSelection);
    },
    [sorted, selection, anchorIndex, onSelect],
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sorted.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, sorted.length - 1);
          handleSelect(next, e.metaKey || e.ctrlKey, e.shiftKey);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          handleSelect(prev, e.metaKey || e.ctrlKey, e.shiftKey);
          virtualizer.scrollToIndex(prev, { align: 'auto' });
          break;
        }
        case 'Home': {
          e.preventDefault();
          handleSelect(0, e.metaKey || e.ctrlKey, e.shiftKey);
          virtualizer.scrollToIndex(0, { align: 'start' });
          break;
        }
        case 'End': {
          e.preventDefault();
          const last = sorted.length - 1;
          handleSelect(last, e.metaKey || e.ctrlKey, e.shiftKey);
          virtualizer.scrollToIndex(last, { align: 'end' });
          break;
        }
        case 'PageDown': {
          e.preventDefault();
          const next = Math.min(focusedIndex + 10, sorted.length - 1);
          handleSelect(next, e.metaKey || e.ctrlKey, e.shiftKey);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          break;
        }
        case 'PageUp': {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 10, 0);
          handleSelect(prev, e.metaKey || e.ctrlKey, e.shiftKey);
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
    [sorted, focusedIndex, handleSelect, onOpen, onDelete, onSelectAll, virtualizer],
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={<FolderOpen />} title={emptyMessage} />
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
      {/* Header — semantic columnheaders so the file table is announced
          correctly by assistive tech. */}
      <div
        role="row"
        className="flex items-center border-b border-border/60 bg-muted/20 text-[11px] font-medium text-muted-foreground no-select"
      >
        <button
          role="columnheader"
          aria-sort={
            sortField === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
          }
          onClick={() => handleSort('name')}
          className="flex flex-1 items-center gap-1 px-3 py-1.5 hover:text-foreground cursor-pointer"
        >
          Name <SortIcon field="name" />
        </button>
        <button
          role="columnheader"
          aria-sort={
            sortField === 'size' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
          }
          onClick={() => handleSort('size')}
          className="flex w-20 items-center justify-end gap-1 px-2 py-1.5 hover:text-foreground cursor-pointer"
        >
          Size <SortIcon field="size" />
        </button>
        {showPermissions && (
          <div role="columnheader" className="w-[84px] px-2 py-1.5 text-right">
            Perms
          </div>
        )}
        <button
          role="columnheader"
          aria-sort={
            sortField === 'modifiedAt' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
          }
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
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
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
                onClick={(e) => {
                  handleSelect(virtualRow.index, e.metaKey || e.ctrlKey, e.shiftKey);
                }}
                onDoubleClick={() => onOpen(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(entry);
                  if (e.key === ' ') {
                    e.preventDefault();
                    handleSelect(virtualRow.index, e.metaKey || e.ctrlKey, e.shiftKey);
                  }
                }}
                draggable={!!onDragStart}
                onDragStart={(e) => onDragStart?.(entry, e)}
              >
                <div
                  className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-[7px]"
                  title={entry.path}
                >
                  {getFileIcon(entry)}
                  <span className={cn('truncate', entry.isDirectory && 'font-medium')}>
                    {entry.name}
                  </span>
                </div>
                <div
                  className="w-20 px-2 py-[7px] text-right text-muted-foreground tabular-nums"
                  title={entry.isDirectory ? undefined : `${entry.size.toLocaleString()} bytes`}
                >
                  {entry.isDirectory ? '\u2014' : formatSize(entry.size)}
                </div>
                {showPermissions && (
                  <div
                    className="w-[84px] px-2 py-[7px] text-right font-mono text-[10px] text-muted-foreground"
                    title={entry.permissions || undefined}
                  >
                    {entry.permissions || '\u2014'}
                  </div>
                )}
                <div
                  className="w-36 px-3 py-[7px] text-right text-muted-foreground tabular-nums"
                  title={new Date(entry.modifiedAt * 1000).toLocaleString()}
                >
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
