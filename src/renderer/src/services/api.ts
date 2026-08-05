/**
 * Seam between renderer components and the preload-exposed IPC API.
 *
 * Why this file exists:
 *   Components historically read `window.api.*` directly, which made unit-
 *   testing them awkward — every test had to monkey-patch a global, and any
 *   test that forgot to restore it leaked into the next one. Going through
 *   `getApi()` lets a test swap the implementation via `__setApiForTesting()`
 *   with no global mutation at all.
 *
 *   It also gives us one place to rehydrate errors coming back across the
 *   contextBridge — see `rehydrate` below.
 *
 * Rule: renderer code calls `getApi()`, never `window.api`. This module is the
 * only place the global is read. `src/test/design-tokens.test.ts` has a
 * companion guard that fails the build if `window.api.` reappears in renderer
 * source, so the seam can't silently erode the way it did before.
 */

import { ErrorCode, LunaError } from '@shared/errors';
import type { LunaAPI } from '../../../preload';

let override: LunaAPI | null = null;
let wrapped: LunaAPI | null = null;

/** Shape the preload rejects with. Kept structural to avoid a runtime import. */
interface IpcErrorPayload {
  __lunaError: true;
  code: ErrorCode;
  message: string;
}

function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return typeof value === 'object' && value !== null && '__lunaError' in value;
}

/**
 * Turn the preload's plain-object rejection back into a real `LunaError`.
 *
 * `contextBridge` clones thrown values and keeps only `message`/`stack` on an
 * `Error`, so the preload cannot hand us a class instance — it rejects with a
 * plain object instead. Rebuilding it here means every renderer call site sees
 * a genuine `LunaError` with a usable `code`, and `err instanceof Error` still
 * holds for the many places that check it.
 */
function rehydrate(err: unknown): unknown {
  if (isIpcErrorPayload(err)) {
    return new LunaError(err.message, err.code ?? ErrorCode.INTERNAL_ERROR);
  }
  return err;
}

/**
 * Wrap every API method so a rejection is rehydrated.
 *
 * Only promise-returning calls are touched; the `on*` subscription methods
 * return an unsubscribe function synchronously and are passed straight
 * through. The wrapper is built once and cached so method identity stays
 * stable across renders — an unstable reference in a `useEffect` dependency
 * list would re-subscribe on every render.
 */
function wrapApi(api: LunaAPI): LunaAPI {
  const wrapFn =
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          throw rehydrate(err);
        });
      }
      return result;
    };

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(api as unknown as Record<string, unknown>)) {
    if (typeof value === 'function') {
      out[key] = wrapFn(value as (...a: unknown[]) => unknown);
    } else if (value && typeof value === 'object') {
      const ns: Record<string, unknown> = {};
      for (const [method, impl] of Object.entries(value as Record<string, unknown>)) {
        ns[method] =
          typeof impl === 'function' ? wrapFn(impl as (...a: unknown[]) => unknown) : impl;
      }
      out[key] = ns;
    } else {
      out[key] = value;
    }
  }
  return out as unknown as LunaAPI;
}

export function getApi(): LunaAPI {
  if (override) return override;
  if (!wrapped) wrapped = wrapApi(window.api);
  return wrapped;
}

/**
 * Test-only: swap the API implementation. Pass `null` to restore.
 *
 * The override is used as-is — a test fake already rejects with whatever it
 * wants, so there is nothing to rehydrate.
 *
 * Prefer `installFakeApi()` from `src/test/fake-api.ts`, which builds a
 * fully-stubbed surface and registers its own cleanup.
 */
export function __setApiForTesting(api: LunaAPI | null): void {
  override = api;
  // Drop the memoised wrapper so a later real-API call re-wraps the current
  // global rather than a stale one captured before the test swapped it.
  wrapped = null;
}
