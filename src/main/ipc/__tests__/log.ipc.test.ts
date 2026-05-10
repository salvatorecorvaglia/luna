import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@shared/constants';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerLogHandlers } from '../log.ipc';
import log from '../../lib/logger';
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

  it('routes error to log.error', async () => {
    await call('error', 'boom');
    expect(error).toHaveBeenCalledWith('[Renderer] boom');
  });

  it('routes debug to log.debug', async () => {
    await call('debug', 'trace');
    expect(debug).toHaveBeenCalledWith('[Renderer] trace');
  });

  it('falls back to info for an unknown level', async () => {
    await call('verbose' as unknown as 'info', 'fallback');
    expect(info).toHaveBeenCalledWith('[Renderer] fallback');
  });
});
