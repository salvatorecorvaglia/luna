import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import log from '../../../src/main/lib/logger';
import { registerLogHandlers } from '../../../src/main/ipc/log.ipc';

const info = log.info as ReturnType<typeof vi.fn>;
const warn = log.warn as ReturnType<typeof vi.fn>;
const error = log.error as ReturnType<typeof vi.fn>;
const debug = log.debug as ReturnType<typeof vi.fn>;

beforeEach(() => {
  handlers.clear();
  info.mockClear();
  warn.mockClear();
  error.mockClear();
  debug.mockClear();
  registerLogHandlers();
});

describe('log IPC', () => {
  function call(level: string, message: string, context?: Record<string, unknown>) {
    const handler = handlers.get(IPC.LOG_MESSAGE)!;
    return handler({}, { level, message, context });
  }

  it('routes info to log.info with the [Renderer] prefix', async () => {
    await call('info', 'hello');
    expect(info).toHaveBeenCalledWith('[Renderer] hello');
  });

  it('routes warn to log.warn and forwards context', async () => {
    await call('warn', 'something off', { detail: 1 });
    expect(warn).toHaveBeenCalledWith('[Renderer] something off', { detail: 1 });
  });

  it('routes error to log.warn with a [Renderer Error] prefix to prevent spam', async () => {
    await call('error', 'boom');
    expect(warn).toHaveBeenCalledWith('[Renderer Error] boom');
  });

  it('routes debug to log.debug', async () => {
    await call('debug', 'trace');
    expect(debug).toHaveBeenCalledWith('[Renderer] trace');
  });

  it('falls back to info for an unknown level', async () => {
    await call('verbose' as unknown as 'info', 'fallback');
    expect(info).toHaveBeenCalledWith('[Renderer] fallback');
  });

  describe('rate limiter', () => {
    it('allows 300 messages per 10s window and rejects the 301st', async () => {
      // Module-level ring buffer survives across tests; jump real time forward
      // by more than the 10s window so prior entries are evicted before we
      // measure the cap fresh.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
        for (let i = 0; i < 300; i++) {
          await call('info', `msg-${i}`);
        }
        await expect(call('info', 'over the cap')).rejects.toThrow(/rate limit/i);
        // After the window slides past, logging becomes available again.
        vi.setSystemTime(new Date('2030-01-01T00:00:11Z'));
        await expect(call('info', 'after window')).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
