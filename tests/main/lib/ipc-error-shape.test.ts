import { ErrorCode, LunaError } from '@shared/errors';
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
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerHandler } from '../../../src/main/lib/ipc-handler';

/**
 * `registerHandler` is generic over the real `IpcChannel` union so production
 * call sites get channel-derived request/response types. These tests need
 * arbitrary throwing handlers on synthetic channels, so they go through a
 * narrow, once-only structural alias rather than sprinkling `as any` at each
 * call site.
 */
type AnyChannelRegister = (
  channel: string,
  handler: (event: unknown, ...args: unknown[]) => unknown,
) => void;
const register = registerHandler as unknown as AnyChannelRegister;

beforeEach(() => {
  handlers.clear();
});

/**
 * What crosses the contextBridge on failure.
 *
 * `LunaError.toObject()` includes `stack` and `metadata`; serialising the whole
 * thing shipped absolute main-process paths, module layout, and arbitrary
 * handler-attached internals to the renderer on *every* failure — including
 * ones a remote server can provoke. That is exactly the reconnaissance an
 * attacker with a renderer foothold wants, and it undercuts the care `emit.ts`
 * takes to redact the event channels.
 */
describe('IPC error serialization', () => {
  async function invokeFailing(error: unknown): Promise<Record<string, unknown>> {
    register('test:channel', () => {
      throw error;
    });
    try {
      await handlers.get('test:channel')!({});
      throw new Error('handler should have thrown');
    } catch (err) {
      return JSON.parse((err as Error).message);
    }
  }

  it('sends only code and message', async () => {
    const payload = await invokeFailing(
      new LunaError('Connection refused', ErrorCode.NETWORK_ERROR, {
        internalPath: '/Users/someone/secret/path.ts',
      }),
    );
    expect(payload).toEqual({ code: 'NETWORK_ERROR', message: 'Connection refused' });
  });

  it('does not leak the stack trace', async () => {
    const payload = await invokeFailing(new LunaError('boom', ErrorCode.INTERNAL_ERROR));
    expect(payload).not.toHaveProperty('stack');
  });

  it('does not leak handler-attached metadata', async () => {
    const payload = await invokeFailing(
      new LunaError('nope', ErrorCode.FORBIDDEN, { absolutePath: '/etc/shadow', uid: 501 }),
    );
    expect(payload).not.toHaveProperty('metadata');
    expect(JSON.stringify(payload)).not.toContain('/etc/shadow');
  });

  it('normalises a plain Error into an INTERNAL_ERROR code', async () => {
    const payload = await invokeFailing(new Error('unexpected'));
    expect(payload).toEqual({ code: 'INTERNAL_ERROR', message: 'unexpected' });
  });

  it('still keeps the original error as `cause` for main-process logging', async () => {
    const original = new LunaError('original', ErrorCode.SFTP_ERROR);
    register('test:cause', () => {
      throw original;
    });
    try {
      await handlers.get('test:cause')!({});
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).cause).toBe(original);
    }
  });
});

describe('IPC payload size guard', () => {
  it('accepts a bare string argument via the fast path', async () => {
    register('test:echo', (_e, s) => s);
    await expect(handlers.get('test:echo')!({}, 'hello')).resolves.toBe('hello');
  });

  it('rejects an over-sized string payload', async () => {
    register('test:big', (_e, s) => (s as string).length);
    const huge = 'x'.repeat(5 * 1024 * 1024);
    await expect(handlers.get('test:big')!({}, huge)).rejects.toThrow(/too large/);
  });

  it('rejects a cyclic (unserialisable) payload rather than passing it through', async () => {
    register('test:cyclic', () => 'ok');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(handlers.get('test:cyclic')!({}, cyclic)).rejects.toThrow(/not JSON-serializable/);
  });
});
