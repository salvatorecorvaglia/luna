// @vitest-environment jsdom
import { ErrorCode, LunaError } from '@shared/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LunaAPI } from '../../../src/preload';
import { __setApiForTesting, getApi } from '../../../src/renderer/src/services/api';

/**
 * Component tests install a fake through `__setApiForTesting`, which getApi()
 * returns verbatim — so the rehydration wrapper applied to the real
 * `window.api` never ran under test. The preload half of the error round-trip
 * is covered in tests/main/preload.test.ts; this covers the renderer half.
 */

function installWindowApi(api: Record<string, unknown>): void {
  (window as unknown as { api: LunaAPI }).api = api as unknown as LunaAPI;
  // Drop the memoised wrapper so the next getApi() wraps this global.
  __setApiForTesting(null);
}

afterEach(() => {
  delete (window as unknown as { api?: LunaAPI }).api;
  __setApiForTesting(null);
});

describe('getApi() rehydration', () => {
  it('turns the preload error payload back into a LunaError with its code', async () => {
    installWindowApi({
      connections: {
        get: vi.fn().mockRejectedValue({
          __lunaError: true,
          code: ErrorCode.NOT_FOUND,
          message: 'no such connection',
        }),
      },
    });

    const err = await getApi()
      .connections.get('missing')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LunaError);
    expect(err).toBeInstanceOf(Error);
    expect((err as LunaError).code).toBe(ErrorCode.NOT_FOUND);
    expect((err as LunaError).message).toBe('no such connection');
  });

  it('passes through rejections that are not the preload payload', async () => {
    const plain = new Error('boom');
    installWindowApi({ connections: { get: vi.fn().mockRejectedValue(plain) } });

    await expect(getApi().connections.get('x')).rejects.toBe(plain);
  });

  it('wraps top-level functions as well as namespaced methods', async () => {
    installWindowApi({
      log: vi.fn().mockRejectedValue({
        __lunaError: true,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'bad level',
      }),
    });

    const err = await getApi()
      .log('info', 'x')
      .catch((e: unknown) => e);
    expect((err as LunaError).code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns subscription unsubscribers synchronously and untouched', () => {
    const unsubscribe = vi.fn();
    installWindowApi({ ssh: { onData: vi.fn(() => unsubscribe) } });

    const off = getApi().ssh.onData(() => {});
    expect(off).toBe(unsubscribe);
  });

  it('keeps method identity stable across calls', () => {
    installWindowApi({ connections: { list: vi.fn().mockResolvedValue([]) } });
    expect(getApi().connections.list).toBe(getApi().connections.list);
  });
});
