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

vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerHandler } from '../../../src/main/lib/ipc-handler';

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

describe('registerHandler sender frame', () => {
  const reg = registerHandler as (channel: unknown, handler: unknown) => void;

  it('refuses an invoke from a subframe', async () => {
    const handler = vi.fn(() => 'ok');
    reg(IPC.APP_GET_VERSION, handler);
    const fn = handlers.get(IPC.APP_GET_VERSION)!;
    const mainFrame = { url: 'file:///index.html' };
    const subframe = { url: 'data:application/pdf;base64,AAAA' };

    const err = await Promise.resolve(fn({ sender: { mainFrame }, senderFrame: subframe })).catch(
      (e: unknown) => e,
    );

    expect(unwrap(err).code).toBe(ErrorCode.FORBIDDEN);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows the main frame', async () => {
    const handler = vi.fn(() => 'ok');
    reg(IPC.APP_GET_VERSION, handler);
    const mainFrame = { url: 'file:///index.html' };
    await expect(
      handlers.get(IPC.APP_GET_VERSION)!({ sender: { mainFrame }, senderFrame: mainFrame }),
    ).resolves.toBe('ok');
  });
});
