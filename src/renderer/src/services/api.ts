/**
 * Seam between renderer components and the preload-exposed IPC API.
 *
 * Why this file exists:
 *   Components historically read `window.api.*` directly, which made unit-
 *   testing them awkward (every test had to monkey-patch `window`). Going
 *   through `getApi()` lets tests swap the implementation via
 *   `__setApiForTesting()` without touching the global.
 *
 * Migration policy:
 *   New code MUST import from here. Existing `window.api.*` call sites can
 *   migrate opportunistically when their component is otherwise touched.
 */

import type { LunarAPI } from '../../../preload';

let override: LunarAPI | null = null;

export function getApi(): LunarAPI {
  return override ?? window.api;
}

/** Test-only: swap the API implementation. Pass `null` to restore. */
export function __setApiForTesting(api: LunarAPI | null): void {
  override = api;
}
