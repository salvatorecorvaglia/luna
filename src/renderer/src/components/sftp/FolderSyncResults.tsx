import type { FolderDiffItem } from '@shared/types/folder-sync';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { Z } from '@/lib/z-layers';

export type SyncChoice = 'upload' | 'download' | 'skip';
export type SyncAction = SyncChoice | 'conflict';
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 40;
const columns = 'minmax(0, 2fr) repeat(2, minmax(0, 1fr)) minmax(0, 1.5fr) minmax(0, 2fr)';
const labels = {
  'only-local': 'Only local',
  'only-remote': 'Only remote',
  modified: 'Metadata differs',
  identical: 'No change suggested',
};

export function FolderSyncResults({
  items,
  choices,
  queued,
  disabled,
  onChoose,
}: {
  items: FolderDiffItem[];
  choices: Map<string, SyncChoice>;
  queued: Set<string>;
  disabled: boolean;
  onChoose: (path: string, choice: SyncChoice) => void;
}) {
  'use no memo';
  const viewportRef = useRef<HTMLDivElement>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const controls = useRef(new Map<string, HTMLSelectElement>());
  const pendingFocus = useRef<string | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => items[index]!.relativePath,
    scrollMargin: HEADER_HEIGHT,
    overscan: 5,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      if (focusedRow !== null && !indices.includes(focusedRow)) indices.push(focusedRow);
      return indices.sort((a, b) => a - b);
    },
  });
  const rows = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const path = pendingFocus.current;
    const control = path ? controls.current.get(path) : null;
    if (control) {
      control.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });
  const unresolved = items.findIndex(
    (item) => item.recommendedAction === 'conflict' && !choices.has(item.relativePath),
  );
  const reviewConflict = () => {
    if (unresolved < 0) return;
    const path = items[unresolved]!.relativePath;
    pendingFocus.current = path;
    virtualizer.scrollToIndex(unresolved, { align: 'center' });
    const control = controls.current.get(path);
    if (control) {
      control.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };
  return (
    <div className="space-y-2">
      {items.some((item) => item.recommendedAction === 'conflict') && (
        <Button variant="outline" disabled={disabled || unresolved < 0} onClick={reviewConflict}>
          Review next unresolved conflict
        </Button>
      )}
      <div
        ref={viewportRef}
        role="region"
        aria-label="Folder comparison results"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrolling results must be reachable by keyboard.
        tabIndex={0}
        className="max-h-60 overflow-auto rounded-lg border border-border font-mono text-xs focus-visible:outline-2 focus-visible:outline-primary"
      >
        <table
          className="block w-full"
          aria-label="Folder comparison"
          aria-rowcount={items.length + 1}
          aria-colcount={5}
        >
          <thead className={`block sticky top-0 ${Z.paneControl} bg-muted`}>
            <tr
              aria-rowindex={1}
              className="grid items-center border-b border-border"
              style={{ gridTemplateColumns: columns, height: HEADER_HEIGHT }}
            >
              {['File', 'Local size', 'Remote size', 'Comparison', 'Action'].map((label) => (
                <th key={label} scope="col" className="px-2 truncate text-left font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            className="block"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {rows.map((row) => {
              const item = items[row.index]!;
              const isQueued = queued.has(item.relativePath);
              const action: SyncAction = choices.get(item.relativePath) ?? item.recommendedAction;
              return (
                <tr
                  key={item.relativePath}
                  aria-rowindex={row.index + 2}
                  className="absolute left-0 right-0 grid items-center border-b border-border/40 hover:bg-accent/30"
                  style={{
                    gridTemplateColumns: columns,
                    height: ROW_HEIGHT,
                    top: row.start - HEADER_HEIGHT,
                  }}
                >
                  <td className="truncate px-2" title={item.relativePath}>
                    {item.relativePath}
                  </td>
                  <td className="truncate px-2 text-muted-foreground">
                    {formatBytes(item.localSize)}
                  </td>
                  <td className="truncate px-2 text-muted-foreground">
                    {formatBytes(item.remoteSize)}
                  </td>
                  <td
                    className={`truncate px-2 ${item.recommendedAction === 'conflict' ? 'text-warning' : 'text-muted-foreground'}`}
                    title={labels[item.status]}
                  >
                    {item.recommendedAction === 'conflict' ? 'Conflict' : labels[item.status]}
                  </td>
                  <td className="px-2 min-w-0">
                    {isQueued ? (
                      <span className="text-success">Queued</span>
                    ) : item.recommendedAction === 'conflict' ? (
                      <select
                        aria-label={`Resolve conflict for ${item.relativePath}`}
                        value={action === 'conflict' ? '' : action}
                        ref={(node) => {
                          if (node) controls.current.set(item.relativePath, node);
                          else controls.current.delete(item.relativePath);
                        }}
                        onFocus={() => setFocusedRow(row.index)}
                        onBlur={() => setFocusedRow(null)}
                        disabled={disabled}
                        onChange={(event) => {
                          if (event.target.value)
                            onChoose(item.relativePath, event.target.value as SyncChoice);
                        }}
                        className="h-7 w-full rounded border border-input bg-background px-1 text-xs focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <option value="" disabled>
                          Choose action
                        </option>
                        <option value="upload">Upload — replace remote</option>
                        <option value="download">Download — replace local</option>
                        <option value="skip">Skip this file</option>
                      </select>
                    ) : (
                      <span>
                        {action === 'upload'
                          ? 'Upload'
                          : action === 'download'
                            ? 'Download'
                            : 'Skip'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
