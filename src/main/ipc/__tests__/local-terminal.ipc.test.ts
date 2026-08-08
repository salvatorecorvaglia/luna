import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const send = vi.fn();
// Both the window and its webContents can be torn down independently, and the
// production code checks both before sending — a webContents destroyed while
// the BrowserWindow object is still alive is exactly the race that used to
// crash the main process from inside the flush timer.
let windowDestroyed = false;
let webContentsDestroyed = false;
const mockWindow = {
  isDestroyed: () => windowDestroyed,
  webContents: { send, isDestroyed: () => webContentsDestroyed },
};

/** Test helper: simulate the user closing the window mid-stream. */
function destroyMockWindow(): void {
  windowDestroyed = true;
  webContentsDestroyed = true;
}

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
  windowDestroyed = false;
  webContentsDestroyed = false;
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

  describe('final output is not lost on teardown', () => {
    // Output is coalesced on a 16ms timer. Every teardown path used to
    // clearTimeout + delete the buffer, discarding up to a full frame — in
    // practice the tail of the last command, or an error printed right before
    // the shell exited. The user saw the "Shell exited" banner with the
    // interesting part missing above it.

    it('flushes buffered output before emitting on-exit', async () => {
      vi.useFakeTimers();
      try {
        await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
        // Produced inside the 16ms window, so it is still buffered.
        ptyInstances[0].__dataCb?.('tail-output');
        ptyInstances[0].__exitCb?.({ exitCode: 0 });

        const channels = send.mock.calls.map((c) => c[0]);
        const dataIdx = channels.indexOf(IPC.LOCAL_TERMINAL_ON_DATA);
        const exitIdx = channels.indexOf(IPC.LOCAL_TERMINAL_ON_EXIT);

        expect(send).toHaveBeenCalledWith(IPC.LOCAL_TERMINAL_ON_DATA, {
          sessionId: 's1',
          data: 'tail-output',
        });
        // Ordering matters: the output has to reach xterm before the banner.
        expect(dataIdx).toBeGreaterThanOrEqual(0);
        expect(dataIdx).toBeLessThan(exitIdx);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not leave a timer armed after the flush on exit', async () => {
      vi.useFakeTimers();
      try {
        await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
        ptyInstances[0].__dataCb?.('tail-output');
        ptyInstances[0].__exitCb?.({ exitCode: 0 });
        send.mockClear();

        // The pending 16ms timer must have been cancelled, not just outrun.
        vi.advanceTimersByTime(100);
        expect(send).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('flushes buffered output when the session is killed', async () => {
      vi.useFakeTimers();
      try {
        await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
        ptyInstances[0].__dataCb?.('pending before kill');
        await handlers.get(IPC.LOCAL_TERMINAL_KILL)!({}, 's1');

        expect(send).toHaveBeenCalledWith(IPC.LOCAL_TERMINAL_ON_DATA, {
          sessionId: 's1',
          data: 'pending before kill',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops the final frame rather than throwing when the window is gone', async () => {
      vi.useFakeTimers();
      try {
        await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
        ptyInstances[0].__dataCb?.('never delivered');
        destroyMockWindow();

        expect(() => ptyInstances[0].__exitCb?.({ exitCode: 0 })).not.toThrow();
        expect(send).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
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

  it('does not send to a window destroyed between output and the flush timer', async () => {
    // Regression: the window was checked when the PTY produced output but not
    // again inside the 16ms flush timer, so closing the window mid-stream
    // called send() on a destroyed webContents. That throws from a timer
    // callback, which the process-level handler answers with process.exit(1).
    vi.useFakeTimers();
    try {
      await handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!({}, { sessionId: 's1', cols: 80, rows: 24 });
      ptyInstances[0].__dataCb?.('output produced while the window was alive');
      destroyMockWindow();

      expect(() => vi.advanceTimersByTime(16)).not.toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to spawn past the concurrent-session cap', async () => {
    const spawnHandler = handlers.get(IPC.LOCAL_TERMINAL_SPAWN)!;
    for (let i = 0; i < 32; i++) {
      await spawnHandler({}, { sessionId: `cap-${i}`, cols: 80, rows: 24 });
    }
    expect(spawn).toHaveBeenCalledTimes(32);

    await expect(spawnHandler({}, { sessionId: 'cap-33', cols: 80, rows: 24 })).rejects.toThrow(
      /Too many local terminals/,
    );
    // The rejected spawn must not have started a process.
    expect(spawn).toHaveBeenCalledTimes(32);
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
