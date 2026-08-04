/**
 * Shared input/clipboard helpers used by both the SSH and Local terminal panes.
 *
 * Previously each pane re-implemented paste/copy/clipboard/keybinding/drag-drop
 * inline (~150 lines duplicated). Extracting the deduplicated parts keeps the
 * two panes byte-for-byte consistent in clipboard and keyboard behavior — past
 * drift between them (e.g. only SSH warned on multi-line paste) was a bug.
 */

import { LIMITS } from '@shared/constants';
import type { Terminal } from '@xterm/xterm';
import { toast } from 'sonner';
import {
  findTabIdForSession,
  getAllSessionIdsFromTree,
  useTerminalStore,
} from '@/stores/terminal-store';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform);

/**
 * Paste text into the terminal. Warns before pasting multi-line content into a
 * shell that hasn't enabled bracketed-paste mode (where unprompted newlines
 * would each execute as separate commands).
 */
export function pasteIntoTerminal(terminal: Terminal, text: string): void {
  if (!text) return;
  const bracketed = (terminal.modes as { bracketedPasteMode?: boolean })?.bracketedPasteMode;
  if (!bracketed && /\r|\n/.test(text)) {
    toast.warning(
      'Clipboard contains multiple lines — each newline will run as a separate command in this shell.',
      {
        action: { label: 'Paste anyway', onClick: () => terminal.paste(text) },
      },
    );
    return;
  }
  terminal.paste(text);
}

/** Copy the current selection to the system clipboard. Returns false if nothing was selected. */
export function copySelectionFromTerminal(terminal: Terminal): boolean {
  if (!terminal.hasSelection()) return false;
  const sel = terminal.getSelection();
  if (!sel) return false;
  void navigator.clipboard.writeText(sel).catch(() => toast.error('Failed to copy to clipboard.'));
  terminal.clearSelection();
  return true;
}

/** Read the clipboard and paste it into the terminal. */
export function readClipboardAndPaste(terminal: Terminal): void {
  navigator.clipboard
    .readText()
    .then((text) => pasteIntoTerminal(terminal, text))
    .catch(() => toast.error('Failed to read from clipboard.'));
}

/**
 * Install the cross-platform key handler shared by both panes — copy/paste,
 * find, clear, and zoom. Returns the handler so callers can pass it directly
 * to `terminal.attachCustomKeyEventHandler`.
 *
 * CRITICAL: never intercepts a plain Ctrl+C on Linux/Windows — that has to
 * reach the shell as SIGINT.
 */
export function buildTerminalKeyHandler(
  terminal: Terminal,
  openSearch: () => void,
): (e: KeyboardEvent) => boolean {
  return (e) => {
    if (e.type !== 'keydown') return true;
    const meta = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
    const mod = isMac ? e.metaKey : e.ctrlKey;

    if (meta && (e.key === 'c' || e.key === 'C')) {
      if (copySelectionFromTerminal(terminal)) {
        e.preventDefault();
        return false;
      }
      // No selection: on macOS Cmd+C is harmless; on Linux/Win this branch is
      // Ctrl+Shift+C — suppress to avoid any default browser action.
      if (!isMac) return false;
      return true;
    }
    if (meta && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      readClipboardAndPaste(terminal);
      return false;
    }
    if (meta && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openSearch();
      return false;
    }
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      terminal.clear();
      return false;
    }
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const { fontSize, setFontSize } = useTerminalStore.getState();
      setFontSize(fontSize + 1);
      return false;
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      const { fontSize, setFontSize } = useTerminalStore.getState();
      setFontSize(fontSize - 1);
      return false;
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      useTerminalStore.getState().setFontSize(LIMITS.DEFAULT_FONT_SIZE);
      return false;
    }

    const isMacSplitVertical = isMac && e.metaKey && !e.shiftKey && e.code === 'KeyD';
    const isMacSplitHorizontal = isMac && e.metaKey && e.shiftKey && e.code === 'KeyD';
    const isWinLinuxSplitVertical = !isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyD';
    const isWinLinuxSplitHorizontal = !isMac && e.ctrlKey && e.shiftKey && e.code === 'KeyH';

    if (isMacSplitVertical || isWinLinuxSplitVertical) {
      e.preventDefault();
      const { activeSessionId, splitSession } = useTerminalStore.getState();
      if (activeSessionId) {
        splitSession(activeSessionId, 'vertical');
      }
      return false;
    }

    if (isMacSplitHorizontal || isWinLinuxSplitHorizontal) {
      e.preventDefault();
      const { activeSessionId, splitSession } = useTerminalStore.getState();
      if (activeSessionId) {
        splitSession(activeSessionId, 'horizontal');
      }
      return false;
    }

    const isNextPane =
      (isMac && e.metaKey && e.altKey && e.code === 'ArrowRight') ||
      (!isMac && e.ctrlKey && e.altKey && e.code === 'ArrowRight');
    const isPrevPane =
      (isMac && e.metaKey && e.altKey && e.code === 'ArrowLeft') ||
      (!isMac && e.ctrlKey && e.altKey && e.code === 'ArrowLeft');

    if (isNextPane || isPrevPane) {
      e.preventDefault();
      const { activeSessionId, layouts, setActiveSession } = useTerminalStore.getState();
      if (activeSessionId) {
        const tabId = findTabIdForSession(layouts, activeSessionId);
        if (tabId) {
          const root = layouts.get(tabId);
          if (root) {
            const allIds = getAllSessionIdsFromTree(root);
            const idx = allIds.indexOf(activeSessionId);
            if (idx !== -1) {
              const nextIdx = isNextPane
                ? (idx + 1) % allIds.length
                : (idx - 1 + allIds.length) % allIds.length;
              setActiveSession(allIds[nextIdx]);
            }
          }
        }
      }
      return false;
    }

    return true;
  };
}

/**
 * Wire wheel-zoom, right-click paste, middle-click paste (Linux), and
 * drag-and-drop of files-as-shell-quoted-paths onto the xterm DOM node.
 * Returns a teardown function that removes every listener it installed.
 */
export function installXtermPointerHandlers(terminal: Terminal, xtermEl: HTMLElement): () => void {
  let wheelPending = false;
  let wheelDelta = 0;
  const onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    wheelDelta += e.deltaY;
    if (wheelPending) return;
    wheelPending = true;
    requestAnimationFrame(() => {
      wheelPending = false;
      const step = -Math.sign(wheelDelta);
      wheelDelta = 0;
      if (step === 0) return;
      const { fontSize, setFontSize } = useTerminalStore.getState();
      setFontSize(fontSize + step);
    });
  };
  xtermEl.addEventListener('wheel', onWheel, { passive: false });

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    readClipboardAndPaste(terminal);
  };
  xtermEl.addEventListener('contextmenu', onContextMenu);

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 1 || !isLinux) return;
    e.preventDefault();
    readClipboardAndPaste(terminal);
  };
  xtermEl.addEventListener('mousedown', onMouseDown);

  // Electron 32+ removed File.path; use text/uri-list (file:// URIs) which
  // works across platforms.
  const onDragOver = (e: DragEvent): void => {
    if (
      e.dataTransfer?.types.includes('Files') ||
      e.dataTransfer?.types.includes('text/uri-list')
    ) {
      e.preventDefault();
    }
  };
  const onDrop = (e: DragEvent): void => {
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const paths = uriList
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'))
        .map((uri) => {
          try {
            const u = new URL(uri);
            if (u.protocol === 'file:') return decodeURIComponent(u.pathname);
          } catch {
            // Not a URL — fall through to use the raw value.
          }
          return uri;
        });
      if (paths.length > 0) {
        const quoted = paths.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
        pasteIntoTerminal(terminal, quoted);
        return;
      }
    }
    const text = dt.getData('text/plain');
    if (text) pasteIntoTerminal(terminal, text);
  };
  xtermEl.addEventListener('dragover', onDragOver);
  xtermEl.addEventListener('drop', onDrop);

  return () => {
    xtermEl.removeEventListener('wheel', onWheel);
    xtermEl.removeEventListener('contextmenu', onContextMenu);
    xtermEl.removeEventListener('mousedown', onMouseDown);
    xtermEl.removeEventListener('dragover', onDragOver);
    xtermEl.removeEventListener('drop', onDrop);
  };
}
