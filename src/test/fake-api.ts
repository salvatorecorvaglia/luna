import { afterEach, vi } from 'vitest';
import type { LunaAPI } from '../preload';
import { __setApiForTesting } from '../renderer/src/services/api';

/**
 * A fully-stubbed `LunaAPI` for renderer component tests.
 *
 * Components reach IPC through `getApi()`, so a test only has to install one
 * of these instead of monkey-patching a global — which previously meant every
 * test hand-rolled a partial `window.api` containing exactly the methods it
 * expected the component to call, and a component that started calling one
 * more failed with a confusing `undefined is not a function` instead of a
 * useful assertion.
 *
 * Every method is a `vi.fn()` with a plausible empty-ish resolution, so a
 * component can be rendered without arranging anything, and a test only
 * overrides what it actually cares about.
 */

/**
 * Event-channel subscriptions resolve to a no-op unsubscribe by default, and
 * never emit.
 *
 * That is a real limitation of this fake: nothing in the renderer's IPC event
 * fan-out — ssh data/close/status, transfer progress, credential tamper,
 * updater — can be driven through it, so every test that needs an event has to
 * override the listener by hand. `emittableListener()` below is the escape
 * hatch for tests that want to push one.
 */
const listener = () => vi.fn(() => vi.fn());

/**
 * A listener stub that records its subscribers and can push a payload to them.
 *
 * Use it to override a specific `on*` method when a test needs to observe how a
 * component reacts to a main-process event:
 *
 *   const onData = emittableListener<{ sessionId: string; data: string }>();
 *   installFakeApi({ ssh: { ...createFakeApi().ssh, onData: onData.subscribe } });
 *   onData.emit({ sessionId: 's1', data: 'hi' });
 */
export function emittableListener<T>(): {
  subscribe: (cb: (payload: T) => void) => () => void;
  emit: (payload: T) => void;
  subscriberCount: () => number;
} {
  const callbacks = new Set<(payload: T) => void>();
  return {
    subscribe: (cb: (payload: T) => void) => {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    emit: (payload: T) => {
      for (const cb of Array.from(callbacks)) cb(payload);
    },
    subscriberCount: () => callbacks.size,
  };
}

/**
 * Structural, not cast.
 *
 * This used to end in `as unknown as LunaAPI`, and the double cast defeated the
 * exact completeness check the file exists to provide: a namespace or method
 * added to the preload did not fail typecheck here, so the fake went quietly
 * stale and the component under test got `undefined is not a function` — the
 * very failure the header comment above says this replaces.
 *
 * Typed as a deep-mocked LunaAPI instead, so the compiler requires every key
 * the bridge exposes. Adding a bridge method now breaks this file, which is the
 * point.
 */
type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : T[K] extends object
      ? Mocked<T[K]>
      : T[K];
};

export function createFakeApi(): Mocked<LunaAPI> {
  return {
    window: {
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
    },
    connections: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      renameFolder: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      reorder: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue([]),
      import: vi.fn().mockResolvedValue({ imported: 0, skipped: [] }),
      importFromFile: vi.fn().mockResolvedValue({ imported: 0, skipped: [] }),
      importFromSshConfig: vi.fn().mockResolvedValue({ imported: 0, skipped: [] }),
    },
    ssh: {
      connect: vi.fn().mockResolvedValue({ success: true }),
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendData: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: listener(),
      onClose: listener(),
      onError: listener(),
      onStatus: listener(),
      onHostKeyChange: listener(),
      trustHostKey: vi.fn().mockResolvedValue({ trusted: true }),
      listActivePortForwards: vi.fn().mockResolvedValue([]),
      startPortForward: vi.fn().mockResolvedValue({}),
      stopPortForward: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      list: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({}),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue({ content: '', encoding: 'utf-8' }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      download: vi.fn().mockResolvedValue('transfer-id'),
      upload: vi.fn().mockResolvedValue('transfer-id'),
      onListTruncated: listener(),
      compareDirectories: vi.fn().mockResolvedValue({ items: [] }),
    },
    s3: {
      connect: vi.fn().mockResolvedValue({ sessionId: 's3-session' }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      generatePresignedUrl: vi.fn().mockResolvedValue('https://example.invalid/signed'),
    },
    shell: {
      readdir: vi.fn().mockResolvedValue([]),
      homeDir: vi.fn().mockResolvedValue('/home/tester'),
      openFileDialog: vi.fn().mockResolvedValue(null),
      saveFileDialog: vi.fn().mockResolvedValue(null),
      // Mirrors the real handler's platform behaviour rather than hardcoding
      // POSIX: the CI matrix runs Windows, where a fake that always joins with
      // '/' quietly diverges from what main would return. basename() on the leaf
      // matches the handler, which refuses to let a path segment traverse.
      joinPath: vi.fn().mockImplementation((base: string, name: string) => {
        const sep = process.platform === 'win32' ? '\\' : '/';
        const leaf = name.split(/[\\/]/).pop() ?? name;
        return `${base.replace(/[\\/]+$/, '')}${sep}${leaf}`;
      }),
      checkFile: vi.fn().mockResolvedValue({ ok: true }),
      readFile: vi.fn().mockResolvedValue({ content: '', encoding: 'utf-8', size: 0 }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      cliReference: vi.fn().mockResolvedValue([]),
      searchHistory: vi.fn().mockResolvedValue([]),
      exportAuditLog: vi.fn().mockResolvedValue(undefined),
    },
    transfers: {
      cancel: vi.fn().mockResolvedValue(undefined),
      cancelBySession: vi.fn().mockResolvedValue(undefined),
      onProgress: listener(),
      onComplete: listener(),
      onError: listener(),
      onCancelled: listener(),
    },
    localTerminal: {
      spawn: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      sendData: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      onData: listener(),
      onExit: listener(),
    },
    credentials: {
      store: vi.fn().mockResolvedValue(undefined),
      retrieve: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
      onTamper: listener(),
      resolveExternal: vi.fn().mockResolvedValue(null),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
    },
    app: {
      getVersion: vi.fn().mockResolvedValue('1.0.0-test'),
      checkUpdate: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      openReleasePage: vi.fn().mockResolvedValue(undefined),
      getLogPath: vi.fn().mockResolvedValue('/tmp/luna.log'),
      openLogFile: vi.fn().mockResolvedValue(undefined),
      getActiveSessions: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
      getCredentialBackend: vi.fn().mockResolvedValue({ backend: 'safeStorage' }),
      onUpdateAvailable: listener(),
      onUpdateDownloadProgress: listener(),
      onUpdateDownloaded: listener(),
      onUpdateError: listener(),
    },
    log: vi.fn().mockResolvedValue(undefined),
    snippets: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    workspaces: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } satisfies Mocked<LunaAPI>;
}

/**
 * Install a fake API for the current test and register its own teardown.
 *
 * Returns the fake so the test can assert on calls or override individual
 * methods. The `afterEach` is registered here rather than left to each caller
 * because a leaked override bleeds into unrelated suites, and that failure
 * mode is miserable to track down.
 */
export function installFakeApi(overrides: Partial<LunaAPI> = {}): Mocked<LunaAPI> {
  const api = Object.assign(createFakeApi(), overrides);
  __setApiForTesting(api as unknown as LunaAPI);
  afterEach(() => __setApiForTesting(null));
  return api;
}
