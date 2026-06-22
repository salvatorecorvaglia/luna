import type { SearchAddon } from '@xterm/addon-search';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { RefObject } from 'react';

interface TerminalSearchBarProps {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  setQuery: (q: string) => void;
  match: { index: number; total: number } | null;
  setMatch?: (m: { index: number; total: number } | null) => void;
  searchAddonRef: RefObject<SearchAddon>;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  /** When false, omit the live "X/Y matches" chip (e.g. local terminal). */
  showMatchCount?: boolean;
}

export function TerminalSearchBar({
  inputRef,
  query,
  setQuery,
  match,
  setMatch,
  searchAddonRef,
  onFindNext,
  onFindPrevious,
  onClose,
  showMatchCount = true,
}: TerminalSearchBarProps) {
  return (
    <div
      role="region"
      aria-label="Terminal search"
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border/80 bg-card px-2 py-1 shadow-lg"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) {
            searchAddonRef.current?.findNext(e.target.value);
          } else {
            searchAddonRef.current?.clearDecorations();
            setMatch?.(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.shiftKey) onFindPrevious();
            else onFindNext();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Search..."
        aria-label="Search terminal output"
        className="w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
      />
      {showMatchCount && query && match && (
        <span
          className={
            match.total === 0
              ? 'text-[10px] text-destructive tabular-nums'
              : 'text-[10px] text-muted-foreground tabular-nums'
          }
          aria-live="polite"
          aria-label={
            match.total === 0 ? 'No matches' : `Match ${match.index + 1} of ${match.total}`
          }
        >
          {match.total === 0 ? 'no matches' : `${match.index + 1}/${match.total}`}
        </span>
      )}

      <button
        onClick={onFindPrevious}
        className="btn-icon !p-0.5"
        title="Previous"
        aria-label="Previous match"
      >
        <ChevronUp className="size-3.5" />
      </button>

      <button onClick={onFindNext} className="btn-icon !p-0.5" title="Next" aria-label="Next match">
        <ChevronDown className="size-3.5" />
      </button>

      <button onClick={onClose} className="btn-icon !p-0.5" title="Close" aria-label="Close search">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
