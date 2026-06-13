import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const send = vi.fn();
const mockWindow = {
  isDestroyed: () => false,
  webContents: { send },
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../app.ipc', () => ({
  getMainWindow: () => mockWindow,
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Each spawn call should hand back a fresh fake pty so we can spy on writes.
type FakePty = {
  onData: (cb: (s: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  __dataCb?: (s: string) => void;
  __exitCb?: (e: { exitCode: number }) => void;
};
const ptyInstances: FakePty[] = [];
const spawn = vi.fn((_shell: string, _args: string[], _opts: unknown): FakePty => {
  const inst: FakePty = {
    onData(cb) {
      inst.__dataCb = cb;
    },
    onExit(cb) {
      inst.__exitCb = cb;
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  ptyInstances.push(inst);
  return inst;
});

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawn(...(args as Parameters<typeof spawn>)),
}));

import { disposeLocalTerminals, registerLocalTerminalHandlers } from '../local-terminal.ipc';

beforeEach(() => {
  handlers.clear();
  send.mockClear();
  spawn.mockClear();
  ptyInstances.length = 0;
  // Each test should start with a clean session map. Easiest reset is to
  // dispose any stragglers from a prior test in this module's lifecycle.
  disposeLocalTerminals();
  registerLocalTerminalHandlers();
});

describe('local-terminal IPC — spawn', () => {
  it('spawns a PTY with the requested cols/rows', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 100, rows: 30 });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][2]).toMatchObject({ cols: 100, rows: 30 });
  });

  it('is idempotent — a second spawn for the same id is ignored', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
    await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('forwards stdout chunks to the renderer via on-data', async () => {
    vi.useFakeTimers();
    try {
      await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
      ptyInstances[0].__dataCb?.('hello');
      vi.advanceTimersByTime(16);
      expect(send).toHaveBeenCalledWith(IPC.LOCAL_TERMINAL_ON_DATA, {
        sessionId: 's1',
        data: 'hello',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits on-exit and clears the session when the PTY exits', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
    ptyInstances[0].__exitCb?.({ exitCode: 0 });
    expect(send).toHaveBeenCalledWith(IPC.LOCAL_TERMINAL_ON_EXIT, {
      sessionId: 's1',
      exitCode: 0,
    });
    // After exit the session is gone — send-data on the same id is a no-op.
    await handlers.get(IPC.LOCAL_TERMINAL_SEND_DATA)!({}, { sessionId: 's1', data: 'x' });
    expect(ptyInstances[0].write).not.toHaveBeenCalled();
  });
});

describe('local-terminal IPC — send/resize/kill', () => {
  beforeEach(async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
  });

  it('writes to the PTY on send-data', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_SEND_DATA)!({}, { sessionId: 's1', data: 'abc' });
    expect(ptyInstances[0].write).toHaveBeenCalledWith('abc');
  });

  it('resizes the PTY', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_RESIZE)!({}, { sessionId: 's1', cols: 120, rows: 40 });
    expect(ptyInstances[0].resize).toHaveBeenCalledWith(120, 40);
  });

  it('kills the PTY and removes the session', async () => {
    await handlers.get(IPC.LOCAL_TERMINAL_KILL)!({}, 's1');
    expect(ptyInstances[0].kill).toHaveBeenCalled();
    // Subsequent send-data is a no-op (no entry in the session map).
    await handlers.get(IPC.LOCAL_TERMINAL_SEND_DATA)!({}, { sessionId: 's1', data: 'x' });
    expect(ptyInstances[0].write).not.toHaveBeenCalled();
  });

  it('send-data on unknown session is a no-op (does not throw)', () => {
    expect(() =>
      handlers.get(IPC.LOCAL_TERMINAL_SEND_DATA)!({}, { sessionId: 'unknown', data: 'x' }),
    ).not.toThrow();
  });
});
