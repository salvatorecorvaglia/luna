/**
 * Session id -> live xterm instance, for the few features that need to read a
 * terminal's contents from outside the pane that owns it.
 *
 * The scrollback exists in exactly one place: the xterm instance inside a
 * TerminalPane. The main process does not keep it (ssh-stream-buffer only
 * coalesces frames in flight), and it is not in any store. So a sibling
 * component like TerminalToolbar had no way to reach it — which is why the
 * audit-log export shipped writing empty files: the dialog took the text as an
 * optional prop, the toolbar had nothing to pass, and the default was ''.
 *
 * A registry rather than a prop chain because the reader (the export dialog)
 * and the owner (the pane) sit in different subtrees, and because the text has
 * to be read at export time — a value passed down at render time is stale by
 * the time the user picks a format.
 */

/**
 * The slice of xterm's `Terminal` that reading scrollback needs.
 *
 * Declared structurally rather than importing `Terminal` so tests can register
 * a plain object: a real Terminal satisfies this, and nothing here needs the
 * other ~200 members.
 */
export interface ScrollbackSource {
  buffer: {
    active: {
      length: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

const terminals = new Map<string, ScrollbackSource>();

export function registerTerminal(sessionId: string, terminal: ScrollbackSource): void {
  terminals.set(sessionId, terminal);
}

export function unregisterTerminal(sessionId: string): void {
  terminals.delete(sessionId);
}

/**
 * Read a session's full buffer — scrollback plus viewport — as text.
 *
 * Returns null when the session has no live terminal, which callers must treat
 * as "nothing to export" rather than as an empty document. Trailing whitespace
 * is trimmed per line (xterm pads every line to the terminal width, so without
 * this every exported line carries a tail of spaces), and trailing blank lines
 * are dropped because the viewport is almost always partly empty.
 */
export function readTerminalScrollback(sessionId: string): string | null {
  const terminal = terminals.get(sessionId);
  if (!terminal) return null;

  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/** Test-only: drop every registration. */
export function __resetTerminalRegistry(): void {
  terminals.clear();
}
