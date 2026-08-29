// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The paste/copy helpers toast on failure and the multi-line warning; keep the
// real sonner out of the way so assertions are about the terminal, not the UI.
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// jsdom ships no navigator.clipboard.
const clipboard = {
  writeText: vi.fn(() => Promise.resolve()),
  readText: vi.fn(() => Promise.resolve('')),
};
Object.defineProperty(window.navigator, 'clipboard', {
  value: clipboard,
  configurable: true,
});

/**
 * `isMac` is computed at module load from `navigator.platform`, so the platform
 * has to be set before the module is imported — hence the dynamic import in
 * `loadModule` and `vi.resetModules()` between cases.
 */
function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

async function loadModule() {
  return import('../../../src/renderer/src/lib/terminal-input');
}

interface FakeTerminal {
  hasSelection: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
  modes: { bracketedPasteMode?: boolean };
}

function fakeTerminal(overrides: Partial<FakeTerminal> = {}): FakeTerminal {
  return {
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    modes: {},
    ...overrides,
  };
}

/** A KeyboardEvent whose preventDefault we can observe. */
function keyEvent(init: KeyboardEventInit & { type?: string }): KeyboardEvent {
  const { type = 'keydown', ...rest } = init;
  const e = new KeyboardEvent(type, { ...rest, cancelable: true });
  vi.spyOn(e, 'preventDefault');
  return e;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('buildTerminalKeyHandler — SIGINT must always reach the shell', () => {
  /**
   * The single most important property of this handler, and the reason its
   * source carries a "CRITICAL" comment. If a plain Ctrl+C is ever swallowed
   * on Linux/Windows, there is no way to interrupt a running remote command —
   * the terminal is effectively broken, and silently so.
   *
   * The module was at 0% coverage, so nothing was holding this in place.
   */
  it.each([
    ['Linux', 'Linux x86_64'],
    ['Windows', 'Win32'],
  ])('does not intercept a plain Ctrl+C on %s', async (_label, platform) => {
    setPlatform(platform);
    const { buildTerminalKeyHandler } = await loadModule();
    // A selection exists — the handler must still not treat plain Ctrl+C as
    // "copy", because on these platforms copy is Ctrl+Shift+C.
    const term = fakeTerminal({ hasSelection: vi.fn(() => true) });
    const handler = buildTerminalKeyHandler(term as never, vi.fn());

    const e = keyEvent({ key: 'c', ctrlKey: true, shiftKey: false });
    // true = "let xterm handle it", i.e. send ^C down the wire.
    expect(handler(e)).toBe(true);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(term.clearSelection).not.toHaveBeenCalled();
  });

  it('treats Ctrl+Shift+C as copy on Linux/Windows', async () => {
    setPlatform('Linux x86_64');
    const { buildTerminalKeyHandler } = await loadModule();
    const term = fakeTerminal({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => 'selected text'),
    });
    const handler = buildTerminalKeyHandler(term as never, vi.fn());

    const e = keyEvent({ key: 'c', ctrlKey: true, shiftKey: true });
    expect(handler(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(term.clearSelection).toHaveBeenCalled();
    expect(clipboard.writeText).toHaveBeenCalledWith('selected text');
  });

  it('uses Cmd+C for copy on macOS and leaves plain Ctrl+C alone', async () => {
    setPlatform('MacIntel');
    const { buildTerminalKeyHandler } = await loadModule();
    const term = fakeTerminal({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => 'selected text'),
    });
    const handler = buildTerminalKeyHandler(term as never, vi.fn());

    const cmdC = keyEvent({ key: 'c', metaKey: true });
    expect(handler(cmdC)).toBe(false);
    expect(cmdC.preventDefault).toHaveBeenCalled();

    // Plain Ctrl+C on macOS is still SIGINT and must pass through.
    const ctrlC = keyEvent({ key: 'c', ctrlKey: true });
    expect(handler(ctrlC)).toBe(true);
    expect(ctrlC.preventDefault).not.toHaveBeenCalled();
  });

  it('passes Cmd+C through to the shell when there is nothing selected on macOS', async () => {
    setPlatform('MacIntel');
    const { buildTerminalKeyHandler } = await loadModule();
    const handler = buildTerminalKeyHandler(fakeTerminal() as never, vi.fn());
    expect(handler(keyEvent({ key: 'c', metaKey: true }))).toBe(true);
  });

  it('ignores keyup entirely', async () => {
    setPlatform('MacIntel');
    const { buildTerminalKeyHandler } = await loadModule();
    const handler = buildTerminalKeyHandler(fakeTerminal() as never, vi.fn());
    expect(handler(keyEvent({ type: 'keyup', key: 'c', metaKey: true }))).toBe(true);
  });
});

describe('buildTerminalKeyHandler — other bindings', () => {
  it('opens search on the platform find chord', async () => {
    setPlatform('MacIntel');
    const { buildTerminalKeyHandler } = await loadModule();
    const openSearch = vi.fn();
    const handler = buildTerminalKeyHandler(fakeTerminal() as never, openSearch);

    const e = keyEvent({ key: 'f', metaKey: true });
    expect(handler(e)).toBe(false);
    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('clears the terminal on the mod+K chord', async () => {
    setPlatform('Linux x86_64');
    const { buildTerminalKeyHandler } = await loadModule();
    const term = fakeTerminal();
    const handler = buildTerminalKeyHandler(term as never, vi.fn());

    // On Linux `mod` is plain Ctrl (not Ctrl+Shift, which is `meta`).
    expect(handler(keyEvent({ key: 'k', ctrlKey: true }))).toBe(false);
    expect(term.clear).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary printable keys to the shell', async () => {
    setPlatform('Linux x86_64');
    const { buildTerminalKeyHandler } = await loadModule();
    const handler = buildTerminalKeyHandler(fakeTerminal() as never, vi.fn());
    for (const key of ['a', 'z', '1', 'Enter', 'ArrowUp', 'Tab']) {
      expect(handler(keyEvent({ key })), `${key} should pass through`).toBe(true);
    }
  });
});

describe('pasteIntoTerminal', () => {
  it('pastes single-line text straight through', async () => {
    setPlatform('MacIntel');
    const { pasteIntoTerminal } = await loadModule();
    const term = fakeTerminal();
    pasteIntoTerminal(term as never, 'echo hello');
    expect(term.paste).toHaveBeenCalledWith('echo hello');
  });

  it('does nothing for empty text', async () => {
    setPlatform('MacIntel');
    const { pasteIntoTerminal } = await loadModule();
    const term = fakeTerminal();
    pasteIntoTerminal(term as never, '');
    expect(term.paste).not.toHaveBeenCalled();
  });

  it('withholds a multi-line paste when the shell has no bracketed-paste mode', async () => {
    // Without bracketed paste every newline executes as a separate command, so
    // pasting a script fragment runs it line by line. The user gets a warning
    // with an explicit opt-in instead.
    setPlatform('MacIntel');
    const { pasteIntoTerminal } = await loadModule();
    const term = fakeTerminal({ modes: { bracketedPasteMode: false } });
    pasteIntoTerminal(term as never, 'line one\nline two');
    expect(term.paste).not.toHaveBeenCalled();
  });

  it('pastes multi-line text directly when bracketed paste is on', async () => {
    setPlatform('MacIntel');
    const { pasteIntoTerminal } = await loadModule();
    const term = fakeTerminal({ modes: { bracketedPasteMode: true } });
    pasteIntoTerminal(term as never, 'line one\nline two');
    expect(term.paste).toHaveBeenCalledWith('line one\nline two');
  });
});

describe('copySelectionFromTerminal', () => {
  it('reports false and copies nothing when there is no selection', async () => {
    setPlatform('MacIntel');
    const { copySelectionFromTerminal } = await loadModule();
    const term = fakeTerminal({ hasSelection: vi.fn(() => false) });
    expect(copySelectionFromTerminal(term as never)).toBe(false);
    expect(term.clearSelection).not.toHaveBeenCalled();
  });

  it('reports false when the selection is empty even though hasSelection is true', async () => {
    setPlatform('MacIntel');
    const { copySelectionFromTerminal } = await loadModule();
    const term = fakeTerminal({
      hasSelection: vi.fn(() => true),
      getSelection: vi.fn(() => ''),
    });
    expect(copySelectionFromTerminal(term as never)).toBe(false);
  });
});
