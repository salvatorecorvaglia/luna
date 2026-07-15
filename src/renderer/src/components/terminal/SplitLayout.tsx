import type { PaneNode } from '@shared/types/terminal';
import { useTerminalStore, getFirstLeafSessionId } from '@/stores/terminal-store';
import { TerminalPane } from './TerminalPane';
import { LocalTerminalPane } from './LocalTerminalPane';
import { Columns, Rows, X } from 'lucide-react';
import React, { useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface SplitLayoutProps {
  node: PaneNode;
  tabId: string;
  activeSessionId: string | null;
}

export function SplitLayout({ node, tabId, activeSessionId }: SplitLayoutProps) {
  const sessions = useTerminalStore((s) => s.sessions);
  const splitSession = useTerminalStore((s) => s.splitSession);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const updateSplitRatio = useTerminalStore((s) => s.updateSplitRatio);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
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

    const handlePointerUp = () => {
      setIsResizing(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [node, tabId, updateSplitRatio]);

  if (node.type === 'terminal') {
    const session = sessions.get(node.sessionId);
    if (!session) return null;

    const isActive = node.sessionId === activeSessionId;
    const isLocal = session.type === 'local';

    return (
      <div 
        onClick={() => {
          if (!isActive) setActiveTab(node.sessionId);
        }}
        className={cn(
          "group relative h-full w-full border transition-all duration-150 overflow-hidden",
          isActive ? "border-primary/80 ring-1 ring-primary/40 bg-background" : "border-border/40 hover:border-border/80 bg-background/95"
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
            className="p-1 hover:bg-destructive/20 hover:text-destructive rounded text-muted-foreground cursor-pointer"
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
      className={cn(
        "flex h-full w-full overflow-hidden",
        isVertical ? "flex-row" : "flex-col"
      )}
    >
      <div style={{ flexGrow: ratio, flexShrink: 1, flexBasis: 0 }} className="overflow-hidden">
        <SplitLayout node={node.children[0]} tabId={tabId} activeSessionId={activeSessionId} />
      </div>

      <div
        onPointerDown={handlePointerDown}
        className={cn(
          "bg-border/60 hover:bg-primary/60 transition-colors z-20",
          isVertical ? "w-1 h-full cursor-col-resize" : "h-1 w-full cursor-row-resize",
          isResizing && "bg-primary/80"
        )}
      />

      <div style={{ flexGrow: 1 - ratio, flexShrink: 1, flexBasis: 0 }} className="overflow-hidden">
        <SplitLayout node={node.children[1]} tabId={tabId} activeSessionId={activeSessionId} />
      </div>
    </div>
  );
}
