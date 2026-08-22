import { vi } from 'vitest';

/**
 * Lightweight stand-ins for `@xterm/xterm` and its addon packages.
 *
 * `use-terminal-session.ts` is the highest-risk, least-verified code in the
 * renderer (lifecycle/cleanup logic wrapped around a real xterm.js instance),
 * but xterm.js itself needs a real canvas/WebGL-capable browser to run — not
 * available in jsdom. These fakes let tests exercise the hook's own lifecycle
 * logic (construction order, cleanup, resize debouncing, fallback wiring)
 * without needing xterm.js to actually render anything.
 *
 * Usage in a test file:
 *   vi.mock('@xterm/xterm', async () => {
 *     const { FakeTerminal } = await import('../../../../src/test/fake-xterm');
 *     return { Terminal: FakeTerminal };
 *   });
 *   (repeat per addon package — see use-terminal-session.test.tsx for the
 *   full set)
 */

type DataHandler = (data: string) => void;
type ResultsHandler = (r: { resultIndex: number; resultCount: number }) => void;
type ContextLossHandler = () => void;

export class FakeTerminal {
  static instances: FakeTerminal[] = [];
  static throwOnNextConstruct = false;

  static last(): FakeTerminal {
    const t = FakeTerminal.instances[FakeTerminal.instances.length - 1];
    if (!t) throw new Error('No FakeTerminal instance constructed yet');
    return t;
  }

  static reset(): void {
    FakeTerminal.instances = [];
    FakeTerminal.throwOnNextConstruct = false;
  }

  options: Record<string, unknown>;
  cols = 80;
  rows = 24;
  element: HTMLElement | null = null;
  unicode = { activeVersion: '6' };
  modes = {};

  private dataHandlers: DataHandler[] = [];

  open = vi.fn((container: HTMLElement) => {
    this.element = container;
  });
  loadAddon = vi.fn<(...args: unknown[]) => unknown>();
  write = vi.fn<(...args: unknown[]) => unknown>();
  dispose = vi.fn<(...args: unknown[]) => unknown>();
  focus = vi.fn<(...args: unknown[]) => unknown>();
  refresh = vi.fn<(...args: unknown[]) => unknown>();
  clear = vi.fn<(...args: unknown[]) => unknown>();
  attachCustomKeyEventHandler = vi.fn<(...args: unknown[]) => unknown>();
  hasSelection = vi.fn(() => false);
  getSelection = vi.fn(() => '');
  clearSelection = vi.fn<(...args: unknown[]) => unknown>();
  paste = vi.fn<(...args: unknown[]) => unknown>();
  onData = vi.fn((cb: DataHandler) => {
    this.dataHandlers.push(cb);
    return { dispose: () => {} };
  });

  constructor(initOptions: Record<string, unknown>) {
    if (FakeTerminal.throwOnNextConstruct) {
      FakeTerminal.throwOnNextConstruct = false;
      throw new Error('xterm construction failed (simulated)');
    }
    this.options = { ...initOptions };
    FakeTerminal.instances.push(this);
  }

  /** Simulate the transport delivering a keystroke from the user. */
  emitData(data: string): void {
    for (const cb of this.dataHandlers) cb(data);
  }
}

export class FakeFitAddon {
  static instances: FakeFitAddon[] = [];
  static reset(): void {
    FakeFitAddon.instances = [];
  }
  static last(): FakeFitAddon {
    const a = FakeFitAddon.instances[FakeFitAddon.instances.length - 1];
    if (!a) throw new Error('No FakeFitAddon instance constructed yet');
    return a;
  }

  fit = vi.fn<(...args: unknown[]) => unknown>();

  constructor() {
    FakeFitAddon.instances.push(this);
  }
}

export class FakeSearchAddon {
  static instances: FakeSearchAddon[] = [];
  static reset(): void {
    FakeSearchAddon.instances = [];
  }
  static last(): FakeSearchAddon {
    const a = FakeSearchAddon.instances[FakeSearchAddon.instances.length - 1];
    if (!a) throw new Error('No FakeSearchAddon instance constructed yet');
    return a;
  }

  private resultsHandlers: ResultsHandler[] = [];

  onDidChangeResults = vi.fn((cb: ResultsHandler) => {
    this.resultsHandlers.push(cb);
    return { dispose: () => {} };
  });
  findNext = vi.fn<(...args: unknown[]) => unknown>();
  findPrevious = vi.fn<(...args: unknown[]) => unknown>();
  clearDecorations = vi.fn<(...args: unknown[]) => unknown>();

  constructor() {
    FakeSearchAddon.instances.push(this);
  }

  emitResults(r: { resultIndex: number; resultCount: number }): void {
    for (const cb of this.resultsHandlers) cb(r);
  }
}

export class FakeWebglAddon {
  static instances: FakeWebglAddon[] = [];
  static throwOnNextConstruct = false;
  static reset(): void {
    FakeWebglAddon.instances = [];
    FakeWebglAddon.throwOnNextConstruct = false;
  }
  static last(): FakeWebglAddon {
    const a = FakeWebglAddon.instances[FakeWebglAddon.instances.length - 1];
    if (!a) throw new Error('No FakeWebglAddon instance constructed yet');
    return a;
  }

  private contextLossHandlers: ContextLossHandler[] = [];

  onContextLoss = vi.fn((cb: ContextLossHandler) => {
    this.contextLossHandlers.push(cb);
    return { dispose: () => {} };
  });
  dispose = vi.fn<(...args: unknown[]) => unknown>();

  constructor() {
    if (FakeWebglAddon.throwOnNextConstruct) {
      FakeWebglAddon.throwOnNextConstruct = false;
      throw new Error('WebGL unavailable (simulated)');
    }
    FakeWebglAddon.instances.push(this);
  }

  triggerContextLoss(): void {
    for (const cb of this.contextLossHandlers) cb();
  }
}

export class FakeCanvasAddon {
  static instances: FakeCanvasAddon[] = [];
  static reset(): void {
    FakeCanvasAddon.instances = [];
  }
  constructor() {
    FakeCanvasAddon.instances.push(this);
  }
}

export class FakeUnicode11Addon {}

export class FakeWebLinksAddon {}

/** Reset every fake's instance registry — call from `beforeEach`. */
export function resetFakeXterm(): void {
  FakeTerminal.reset();
  FakeFitAddon.reset();
  FakeSearchAddon.reset();
  FakeWebglAddon.reset();
  FakeCanvasAddon.reset();
}
