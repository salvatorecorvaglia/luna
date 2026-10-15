import { vi } from 'vitest';
import type { LunaAPI } from '../preload';
import { __setApiForTesting } from '../renderer/src/services/api';
import type { ActivePortForwardInfo, Connection } from '../shared/types/connection';
import type { Snippet } from '../shared/types/snippet';
import type { StorageStatResult } from '../shared/types/storage-provider';
import type { WorkspacePreset } from '../shared/types/workspace';

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

/**
 * A mock that resolves to `value`, typed by what it resolves to.
 *
 * `vi.fn().mockResolvedValue(x)` is `Mock<(...args: any[]) => any>`, which is
 * assignable to every method type, so `satisfies Mocked<LunaAPI>` below only
 * ever checked that the *keys* existed — `app.checkUpdate` resolved
 * `undefined` for months against a real `{ available, manual }` response.
 * Carrying the resolved type through lets the compiler check the value too.
 */
const resolves = <T>(value: T) => vi.fn((..._args: unknown[]) => Promise.resolve(value));

/** Minimal well-formed payloads for the handlers whose responses are records. */
const FAKE_CONNECTION: Connection = {
  id: 'conn-1',
  name: 'Test host',
  provider: 'sftp',
  host: 'example.invalid',
  port: 22,
  username: 'tester',
  authType: 'password',
  folder: 'default',
  createdAt: 0,
  updatedAt: 0,
};
const FAKE_FORWARD: ActivePortForwardInfo = {
  id: 'fwd-1',
  connectionId: 'conn-1',
  type: 'local',
  bindAddress: '127.0.0.1',
  localPort: 8080,
  status: 'active',
};
const FAKE_STAT: StorageStatResult = {
  size: 0,
  modifiedAt: 0,
  isDirectory: false,
  isSymlink: false,
};
const FAKE_SNIPPET: Snippet = {
  id: 'snip-1',
  title: 'Snippet',
  command: 'true',
  createdAt: 0,
  updatedAt: 0,
};
const FAKE_WORKSPACE: WorkspacePreset = {
  id: 'ws-1',
  name: 'Workspace',
  layout: { connectionIds: [] },
  createdAt: 0,
  updatedAt: 0,
};

export function createFakeApi(): Mocked<LunaAPI> {
  return {
    window: {
      minimize: resolves(undefined),
      maximize: resolves(undefined),
      close: resolves(undefined),
      isMaximized: resolves(false),
    },
    connections: {
      list: resolves([]),
      get: resolves(null),
      create: resolves(FAKE_CONNECTION),
      update: resolves(FAKE_CONNECTION),
      renameFolder: resolves(undefined),
      delete: resolves(undefined),
      deleteAll: resolves(undefined),
      reorder: resolves(undefined),
      export: resolves([]),
      import: resolves({ imported: 0, skipped: [] }),
      importFromFile: resolves({ imported: 0, skipped: [] }),
      importFromSshConfig: resolves({ imported: 0, skipped: [] }),
    },
    ssh: {
      connect: resolves({ success: true }),
      testConnection: resolves({ ok: true }),
      disconnect: resolves(undefined),
      sendData: resolves(undefined),
      resize: resolves(undefined),
      ackData: resolves(undefined),
      onData: listener(),
      onClose: listener(),
      onError: listener(),
      onStatus: listener(),
      onHostKeyChange: listener(),
      trustHostKey: resolves({ trusted: true }),
      listActivePortForwards: resolves([]),
      startPortForward: resolves(FAKE_FORWARD),
      stopPortForward: resolves(undefined),
    },
    storage: {
      list: resolves([]),
      stat: resolves(FAKE_STAT),
      mkdir: resolves(undefined),
      rename: resolves(undefined),
      delete: resolves(undefined),
      readFile: resolves({ content: '', encoding: 'utf-8' }),
      writeFile: resolves(undefined),
      download: resolves('transfer-id'),
      upload: resolves('transfer-id'),
      onListTruncated: listener(),
      compareDirectories: resolves({
        items: [],
        onlyLocalCount: 0,
        onlyRemoteCount: 0,
        modifiedCount: 0,
        identicalCount: 0,
      }),
    },
    s3: {
      connect: resolves({ sessionId: 's3-session' }),
      disconnect: resolves(undefined),
      testConnection: resolves({ ok: true }),
      generatePresignedUrl: resolves('https://example.invalid/signed'),
    },
    shell: {
      readdir: resolves([]),
      homeDir: resolves('/home/tester'),
      openFileDialog: resolves(null),
      saveFileDialog: resolves(null),
      // Mirrors the real handler's platform behaviour rather than hardcoding
      // POSIX: the CI matrix runs Windows, where a fake that always joins with
      // '/' quietly diverges from what main would return. basename() on the leaf
      // matches the handler, which refuses to let a path segment traverse.
      joinPath: vi.fn().mockImplementation((base: string, name: string) => {
        const sep = process.platform === 'win32' ? '\\' : '/';
        const leaf = name.split(/[\\/]/).pop() ?? name;
        return `${base.replace(/[\\/]+$/, '')}${sep}${leaf}`;
      }),
      checkFile: resolves({ ok: true }),
      readFile: resolves({ content: '', encoding: 'utf-8', size: 0 }),
      writeFile: resolves(undefined),
      cliReference: resolves([]),
      exportAuditLog: resolves({ success: true, path: '/home/tester/audit.html' }),
    },
    transfers: {
      cancel: resolves(undefined),
      cancelBySession: resolves(undefined),
      onProgress: listener(),
      onComplete: listener(),
      onError: listener(),
      onCancelled: listener(),
    },
    localTerminal: {
      spawn: resolves(undefined),
      kill: resolves(undefined),
      sendData: resolves(undefined),
      resize: resolves(undefined),
      ackData: resolves(undefined),
      onData: listener(),
      onExit: listener(),
    },
    credentials: {
      onTamper: listener(),
    },
    settings: {
      get: resolves(null),
      set: resolves(undefined),
      getAll: resolves({}),
    },
    app: {
      getVersion: resolves('1.1.0-test'),
      checkUpdate: resolves({ available: false, manual: false }),
      installUpdate: resolves(undefined),
      openReleasePage: resolves(undefined),
      openExternal: resolves(undefined),
      getLogPath: resolves('/tmp/luna.log'),
      openLogFile: resolves(undefined),
      getActiveSessions: resolves({ ssh: [], s3: [] }),
      getCredentialBackend: resolves({ backend: 'safeStorage' }),
      onUpdateAvailable: listener(),
      onUpdateDownloadProgress: listener(),
      onUpdateDownloaded: listener(),
      onUpdateError: listener(),
    },
    log: resolves(undefined),
    snippets: {
      list: resolves([]),
      create: resolves(FAKE_SNIPPET),
      update: resolves(FAKE_SNIPPET),
      delete: resolves(undefined),
    },
    workspaces: {
      list: resolves([]),
      create: resolves(FAKE_WORKSPACE),
      delete: resolves(undefined),
    },
  } satisfies Mocked<LunaAPI>;
}

/**
 * Install a fake API for the current test.
 *
 * Returns the fake so the test can assert on calls or override individual
 * methods. Teardown is a global `afterEach` in `src/test/setup.ts`, so a
 * leaked override can never bleed into the next test.
 */
export function installFakeApi(overrides: Partial<LunaAPI> = {}): Mocked<LunaAPI> {
  const api = Object.assign(createFakeApi(), overrides);
  __setApiForTesting(api as unknown as LunaAPI);
  return api;
}
