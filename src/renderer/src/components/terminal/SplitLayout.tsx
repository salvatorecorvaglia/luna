import type { PaneNode } from '@shared/types/terminal';
import { Columns, Rows, X } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getFirstLeafSessionId, useTerminalStore } from '@/stores/terminal-store';
import { LocalTerminalPane } from './LocalTerminalPane';
import { TerminalPane } from './TerminalPane';

interface SplitLayoutProps {
  node: PaneNode;
  tabId: string;
  activeSessionId: string | null;
}

function SplitLayoutInner({ node, tabId, activeSessionId }: SplitLayoutProps) {
  // Select only this node's own session (when it's a leaf), not the whole
  // Map. `sessions.get(x)` returns the *same* object reference for any entry
  // that wasn't the one just mutated, so a status/rename change to session A
  // no longer re-renders the SplitLayout instance rendering unrelated
  // session B.
  const session = useTerminalStore((s) =>
    node.type === 'terminal' ? s.sessions.get(node.sessionId) : undefined,
  );
  const splitSession = useTerminalStore((s) => s.splitSession);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const updateSplitRatio = useTerminalStore((s) => s.updateSplitRatio);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Drag-state refs instead of relying on the pointerup handler alone to
  // detach `window` listeners: if this pane closes mid-drag (e.g. a
  // keyboard shortcut fires while the user is still holding the splitter),
  // no pointerup ever arrives and the listeners leaked, continuing to call
  // updateSplitRatio for a tab that no longer exists. The effect's cleanup
  // now runs on unmount regardless of whether the drag ended normally.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      if (!containerRef.current || node.type !== 'split') return;

      setIsResizing(true);
      const rect = containerRef.current.getBoundingClientRect();

      const handlePointerMove = (moveEvent: PointerEvent) => {
        let ratio: number;
        if (node.direction === 'vertical') {
          ratio = (moveEvent.clientX - rect.left) / rect.width;
        } else {
          ratio = (moveEvent.clientY - rect.top) / rect.height;
        }
        ratio = Math.max(0.1, Math.min(0.9, ratio));
        const leftKey = getFirstLeafSessionId(node.children[0]);
        updateSplitRatio(tabId, leftKey, ratio);
      };

      const detach = (): void => {
        setIsResizing(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        dragCleanupRef.current = null;
      };

      const handlePointerUp = (): void => detach();

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      dragCleanupRef.current = detach;
    },
    [node, tabId, updateSplitRatio],
  );

  if (node.type === 'terminal') {
    if (!session) return null;

    const isActive = node.sessionId === activeSessionId;
    const isLocal = session.type === 'local';

    return (
      <div
        onClick={() => {
          if (!isActive) setActiveSession(node.sessionId);
        }}
        // xterm's own input element is independently focusable, so a
        // keyboard user tabbing into a pane (rather than clicking it) could
        // type into a terminal that never became the app's "active" one —
        // this focus handler (bubbling up from that descendant) keeps the
        // two in sync regardless of how the pane was reached.
        onFocus={() => {
          if (!isActive) setActiveSession(node.sessionId);
        }}
        className={cn(
          'group relative h-full w-full border transition-all duration-150 overflow-hidden',
          isActive
            ? 'border-primary/80 ring-1 ring-primary/40 bg-background'
            : 'border-border/40 hover:border-border/80 bg-background/95',
        )}
      >
        {/* Floating action bar */}
        <div className="absolute right-2 top-2 z-30 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 backdrop-blur border border-border/80 rounded-md p-1 shadow-md">
          <button
            onClick={(e) => {
              e.stopPropagation();
              splitSession(node.sessionId, 'vertical');
            }}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground cursor-pointer"
            title="Split Vertically"
          >
            <Columns className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              splitSession(node.sessionId, 'horizontal');
            }}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground cursor-pointer"
            title="Split Horizontally"
          >
            <Rows className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTab(node.sessionId);
            }}
            className="p-1 hover:bg-destructive/20 hover:text-destructive-fg rounded text-muted-foreground cursor-pointer"
            title="Close Pane"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {isLocal ? (
          <LocalTerminalPane sessionId={node.sessionId} isActive={isActive} />
        ) : (
          <TerminalPane sessionId={node.sessionId} isActive={isActive} />
        )}
      </div>
    );
  }

  const isVertical = node.direction === 'vertical';
  const ratio = node.ratio ?? 0.5;

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full overflow-hidden', isVertical ? 'flex-row' : 'flex-col')}
    >
      <div style={{ flexGrow: ratio, flexShrink: 1, flexBasis: 0 }} className="overflow-hidden">
        <SplitLayout node={node.children[0]} tabId={tabId} activeSessionId={activeSessionId} />
      </div>

      <div
        onPointerDown={handlePointerDown}
        className={cn(
          'bg-border/60 hover:bg-primary/60 transition-colors z-20',
          isVertical ? 'w-1 h-full cursor-col-resize' : 'h-1 w-full cursor-row-resize',
          isResizing && 'bg-primary/80',
        )}
      />

      <div style={{ flexGrow: 1 - ratio, flexShrink: 1, flexBasis: 0 }} className="overflow-hidden">
        <SplitLayout node={node.children[1]} tabId={tabId} activeSessionId={activeSessionId} />
      </div>
    </div>
  );
}

// Wrapped in memo so that when a parent re-render produces referentially
// equal `node`/`tabId`/`activeSessionId` props (e.g. another tab's session
// status changed, not this tab's layout), React skips re-rendering this
// entire subtree — including the terminal panes it hosts — instead of
// reconciling it. Named `SplitLayoutInner` above (not `SplitLayout`) so the
// recursive `<SplitLayout .../>` calls inside its own body resolve to this
// memoized export rather than shadowing it with the raw inner function.
export const SplitLayout = memo(SplitLayoutInner);
