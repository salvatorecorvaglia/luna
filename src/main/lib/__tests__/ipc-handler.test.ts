import { IPC } from '@shared/constants';
import { ErrorCode } from '@shared/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerHandler } from '../ipc-handler';

beforeEach(() => {
  handlers.clear();
});

/**
 * Unwrap the JSON-stringified Error payload that registerHandler() rethrows
 * to the renderer. Mirrors the renderer's unwrapIpcError shape.
 */
function unwrap(err: unknown): { code: string; message: string } {
  if (!(err instanceof Error)) throw new Error('expected Error');
  return JSON.parse(err.message) as { code: string; message: string };
}

describe('registerHandler payload validation', () => {
  it('rejects cyclic args with a validation error instead of silently passing', async () => {
    const handler = vi.fn(() => 'ok');
    // Cast through unknown — the channel-args type doesn't matter for this
    // boundary test; we just need a registered channel to invoke.
    const reg = registerHandler as (channel: unknown, handler: unknown) => void;
    reg(IPC.LOG_MESSAGE, handler);
    const fn = handlers.get(IPC.LOG_MESSAGE)!;

    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    await expect(fn({}, cyclic)).rejects.toMatchObject({
      message: expect.stringContaining(ErrorCode.VALIDATION_ERROR),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects payloads exceeding the size cap', async () => {
    const handler = vi.fn(() => 'ok');
    const reg = registerHandler as (channel: unknown, handler: unknown) => void;
    reg(IPC.LOG_MESSAGE, handler);
    const fn = handlers.get(IPC.LOG_MESSAGE)!;

    // 5 MiB string — comfortably over the 4 MiB cap.
    const huge = 'a'.repeat(5 * 1024 * 1024);
    let caught: unknown;
    try {
      await fn({}, { msg: huge });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(unwrap(caught).code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(unwrap(caught).message).toMatch(/too large/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes well-formed args through to the handler', async () => {
    const handler = vi.fn(() => 'ok');
    const reg = registerHandler as (channel: unknown, handler: unknown) => void;
    reg(IPC.LOG_MESSAGE, handler);
    const fn = handlers.get(IPC.LOG_MESSAGE)!;

    const result = await fn({}, { level: 'info', message: 'hi' });
    expect(result).toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });
});
