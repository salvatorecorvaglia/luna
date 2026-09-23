import { IPC } from '@shared/constants';
import { ErrorCode } from '@shared/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LunaAPI } from '../../src/preload';

/**
 * The preload is the entire renderer↔main attack surface, and it was at 0%
 * coverage. vitest.config.ts was changed specifically to measure it ("hid
 * regressions in invoke() and createEventListener()") — but adding it to the
 * include list only put it in the denominator, because no test imported it. The
 * Playwright suite exercises it for real, and Playwright is not measured.
 *
 * Both primitives here exist because of a bug that unit tests structurally
 * could not see: contextBridge clones thrown values and keeps only
 * message/stack on an Error, so a LunaError arrived in the renderer as a bare
 * Error with no `code`, and every consumer branching on it silently never
 * fired. This file covers the recovery logic that fixes it; smoke.spec.ts
 * covers the clone itself.
 */

const invokeMock = vi.fn();
const onMock = vi.fn();
const removeListenerMock = vi.fn();
const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invokeMock(...args),
    on: (...args: unknown[]) => onMock(...args),
    removeListener: (...args: unknown[]) => removeListenerMock(...args),
  },
}));

/**
 * The object the preload hands to contextBridge. Typed as the real LunaAPI so
 * these tests exercise the same shape the renderer sees — a loose Record would
 * make every access optional under noUncheckedIndexedAccess and hide typos.
 */
async function loadPreload(): Promise<LunaAPI> {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  const mod = await import('../../src/preload/index');
  const call = exposeInMainWorld.mock.calls.at(-1);
  expect(call?.[0]).toBe('api');
  // The module's own export type is the contract; the exposed object is it.
  void mod;
  return call?.[1] as LunaAPI;
}

beforeEach(() => {
  invokeMock.mockReset();
  onMock.mockReset();
  removeListenerMock.mockReset();
});

describe('preload bridge surface', () => {
  it('exposes exactly one global, named api', async () => {
    await loadPreload();
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
  });

  it('binds each method to its channel without constructing channels dynamically', async () => {
    const api = await loadPreload();

    invokeMock.mockResolvedValue([]);
    await api.connections.list();
    expect(invokeMock).toHaveBeenCalledWith(IPC.CONNECTION_LIST);

    invokeMock.mockResolvedValue(undefined);
    await api.ssh.disconnect('sess-1');
    expect(invokeMock).toHaveBeenCalledWith(IPC.SSH_DISCONNECT, 'sess-1');
  });

  it('omits the payload argument entirely for void-request channels', async () => {
    // invoke() is overloaded so a void-request channel passes no second
    // argument. Sending an explicit `undefined` would reach main as an argument
    // and defeat the payload-size fast path in ipc-handler.
    const api = await loadPreload();
    invokeMock.mockResolvedValue('1.0.0');
    await api.app.getVersion();
    expect(invokeMock).toHaveBeenCalledWith(IPC.APP_GET_VERSION);
    expect(invokeMock.mock.calls[0]).toHaveLength(1);
  });
});

describe('preload error translation', () => {
  it('recovers code and message from the JSON envelope main throws', async () => {
    const api = await loadPreload();
    invokeMock.mockRejectedValue(
      new Error(
        `Error invoking remote method '${IPC.CONNECTION_GET}': Error: ` +
          JSON.stringify({ code: ErrorCode.VALIDATION_ERROR, message: 'port must be 1..65535' }),
      ),
    );

    await expect(api.connections.get('x')).rejects.toMatchObject({
      __lunaError: true,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'port must be 1..65535',
    });
  });

  it('rejects with a plain object, not an Error', async () => {
    // The whole point: contextBridge clones an Error down to message/stack and
    // drops own properties, so `code` never survived. A plain object is cloned
    // with its properties intact.
    const api = await loadPreload();
    invokeMock.mockRejectedValue(new Error('boom'));

    const err = await api.connections.list().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(Error);
    expect(err).toMatchObject({ __lunaError: true, code: ErrorCode.INTERNAL_ERROR });
  });

  it('strips the "Error invoking remote method" prefix from a bare message', async () => {
    const api = await loadPreload();
    invokeMock.mockRejectedValue(
      new Error(`Error invoking remote method '${IPC.CONNECTION_LIST}': Error: sqlite is locked`),
    );

    await expect(api.connections.list()).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'sqlite is locked',
    });
  });

  it('leaves a message that is not enveloped alone', async () => {
    const api = await loadPreload();
    invokeMock.mockRejectedValue(new Error('plain failure'));
    await expect(api.connections.list()).rejects.toMatchObject({ message: 'plain failure' });
  });

  it('does not mistake unparseable brace-wrapped text for the envelope', async () => {
    // The envelope is detected by a leading `{` and trailing `}`, so a remote
    // message that merely looks like JSON must fall through as text rather than
    // throwing out of the parse.
    const api = await loadPreload();
    invokeMock.mockRejectedValue(new Error('{not json at all}'));
    await expect(api.connections.list()).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      message: '{not json at all}',
    });
  });

  it('handles a non-Error rejection', async () => {
    const api = await loadPreload();
    invokeMock.mockRejectedValue('just a string');
    await expect(api.connections.list()).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'just a string',
    });
  });
});

describe('preload event listeners', () => {
  it('subscribes on the channel and unwraps the payload for the callback', async () => {
    const api = await loadPreload();
    const received: unknown[] = [];

    api.ssh.onData((payload: unknown) => received.push(payload));

    expect(onMock).toHaveBeenCalledWith(IPC.SSH_ON_DATA, expect.any(Function));
    const listener = onMock.mock.calls[0]?.[1] as (e: unknown, p: unknown) => void;
    // The IpcRendererEvent first argument must not reach the callback.
    listener({ sender: 'ignored' }, { sessionId: 's1', data: 'hello' });
    expect(received).toEqual([{ sessionId: 's1', data: 'hello' }]);
  });

  it('returns a cleanup that removes the exact listener it registered', async () => {
    const api = await loadPreload();
    const cleanup = api.ssh.onClose(() => undefined);

    const registered = onMock.mock.calls[0]?.[1];
    cleanup();

    // removeListener with the same reference, not removeAllListeners — which
    // would tear down every other subscriber on the channel.
    expect(removeListenerMock).toHaveBeenCalledWith(IPC.SSH_ON_CLOSE, registered);
  });

  it('gives each subscription its own listener so one cleanup cannot unhook another', async () => {
    const api = await loadPreload();
    const first = api.ssh.onError(() => undefined);
    api.ssh.onError(() => undefined);

    const firstListener = onMock.mock.calls[0]?.[1];
    const secondListener = onMock.mock.calls[1]?.[1];
    expect(firstListener).not.toBe(secondListener);

    first();
    expect(removeListenerMock).toHaveBeenCalledTimes(1);
    expect(removeListenerMock).toHaveBeenCalledWith(IPC.SSH_ON_ERROR, firstListener);
  });
});
