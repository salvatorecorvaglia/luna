import { expect, test } from '@playwright/test';
import type { LunaAPI } from '../../src/preload';
import { closeApp, type LaunchedApp, launchApp } from './fixtures';

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test.describe('application boot', () => {
  test('opens a window and renders the shell', async () => {
    const { page } = launched;
    await expect(page.locator('#root')).toBeAttached();
    // The welcome view is what an empty profile shows; reaching it proves the
    // renderer bundle loaded, React mounted, and no boot-time throw occurred.
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('reports no renderer console errors during boot', async () => {
    const { app } = launched;
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});

test.describe('window security posture', () => {
  test('keeps the renderer isolated and sandboxed', async () => {
    // These are the settings that make "the renderer is untrusted" true rather
    // than aspirational. A regression here silently removes the guarantee the
    // whole IPC validation layer is built on, and no unit test can observe it.
    const prefs = await launched.app.evaluate(({ BrowserWindow }) => {
      // Non-null: the app has finished booting by the time this test runs.
      const win = BrowserWindow.getAllWindows()[0]!;
      return (
        win.webContents as unknown as { getLastWebPreferences: () => Record<string, unknown> }
      ).getLastWebPreferences();
    });

    expect(prefs?.contextIsolation).toBe(true);
    expect(prefs?.nodeIntegration).toBeFalsy();
    expect(prefs?.sandbox).toBe(true);
    expect(prefs?.webviewTag).toBeFalsy();
  });

  test('does not expose Node primitives to the renderer', async () => {
    const leaked = await launched.page.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>).require,
      process: typeof (globalThis as Record<string, unknown>).process,
      module: typeof (globalThis as Record<string, unknown>).module,
    }));
    expect(leaked).toEqual({
      require: 'undefined',
      process: 'undefined',
      module: 'undefined',
    });
  });

  test('exposes exactly the contextBridge surface, and nothing else', async () => {
    const shape = await launched.page.evaluate(() => {
      const api = (window as unknown as { api?: Record<string, unknown> }).api;
      if (!api) return null;
      return Object.keys(api).sort();
    });

    expect(shape).not.toBeNull();
    // If a new namespace is added to preload, this list should be updated
    // deliberately — the bridge is the entire attack surface.
    expect(shape).toEqual(
      [
        'app',
        'connections',
        'credentials',
        'localTerminal',
        'log',
        's3',
        'settings',
        'shell',
        'snippets',
        'ssh',
        'storage',
        'transfers',
        'window',
        'workspaces',
      ].sort(),
    );
  });
});

test.describe('IPC contract', () => {
  /**
   * The gap unit tests structurally cannot close.
   *
   * Both sides of the bridge import the same `IpcHandlerMap`, so a channel
   * renamed in one place and not the other still typechecks and still passes
   * every mocked test — nothing proves a *handler is actually registered* for
   * the channel the preload invokes. Here the real main process answers.
   */
  test('every read-only bridge method reaches a live main handler', async () => {
    const results = await launched.page.evaluate(async () => {
      const api = (window as unknown as { api: LunaAPI }).api;
      const calls: [string, () => Promise<unknown>][] = [
        ['app.getVersion', () => api.app.getVersion()],
        ['app.getLogPath', () => api.app.getLogPath()],
        ['app.getActiveSessions', () => api.app.getActiveSessions()],
        ['app.getCredentialBackend', () => api.app.getCredentialBackend()],
        ['connections.list', () => api.connections.list()],
        ['connections.export', () => api.connections.export()],
        ['settings.getAll', () => api.settings.getAll()],
        ['shell.homeDir', () => api.shell.homeDir()],
        ['snippets.list', () => api.snippets.list()],
        ['workspaces.list', () => api.workspaces.list()],
        ['ssh.listActivePortForwards', () => api.ssh.listActivePortForwards()],
      ];

      const out: Record<string, string> = {};
      for (const [name, call] of calls) {
        try {
          await call();
          out[name] = 'ok';
        } catch (err) {
          out[name] = err instanceof Error ? err.message : String(err);
        }
      }
      return out;
    });

    for (const [name, result] of Object.entries(results)) {
      expect(result, `${name} did not reach a handler: ${result}`).toBe('ok');
    }
  });

  /**
   * Regression: contextBridge clones thrown values and keeps only
   * message/stack on an Error, so a LunaError reconstructed in preload
   * arrived here as a bare Error with no `code`. Everything branching on the
   * code — cancellation detection, per-code descriptions — silently never
   * fired in a real build, and no mocked test could see it because none of
   * them cross a real bridge.
   */
  test('rejects an invalid payload with a structured error, not a crash', async () => {
    const outcome = await launched.page.evaluate(async () => {
      const api = (window as unknown as { api: LunaAPI }).api;
      try {
        // Port 0 is outside the validated 1..65535 range.
        await api.ssh.testConnection({
          config: {
            host: 'example.com',
            port: 0,
            username: 'x',
            authType: 'password',
          },
        });
        return { threw: false, code: null, message: null };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { threw: true, code: e.code ?? null, message: e.message ?? null };
      }
    });

    expect(outcome.threw).toBe(true);
    expect(outcome.code).toBe('VALIDATION_ERROR');
    // The renderer must receive code + message only — no stack, no metadata.
    expect(outcome.message).not.toContain('/src/main/');
  });

  test('does not ship main-process stack traces across the bridge', async () => {
    const outcome = await launched.page.evaluate(async () => {
      const api = (window as unknown as { api: LunaAPI }).api;
      try {
        // '\0' as an escape, not a raw NUL byte in the source. The byte was
        // what made this file binary to grep and unmatchable to text tooling.
        await api.connections.get('does-not-exist-\0-invalid');
        return { threw: false, keys: [] as string[] };
      } catch (e) {
        return { threw: true, keys: Object.keys(e as object).sort() };
      }
    });

    // Previously `if (err) { ...assert... }`, which passed vacuously whenever
    // the call did not throw - so the one case where these assertions mattered
    // least was also the only case that skipped them. Assert the throw first.
    expect(outcome.threw).toBe(true);
    expect(outcome.keys).not.toContain('stack');
    expect(outcome.keys).not.toContain('metadata');
    // And that what crossed the bridge is our structured envelope.
    expect(outcome.keys).toContain('code');
  });
});

test.describe('clipboard', () => {
  /**
   * Regression: `setPermissionCheckHandler(() => false)` in src/main/index.ts
   * denied Chromium's `clipboard-read` and `clipboard-sanitized-write`, which
   * silently killed all nine clipboard call sites in the renderer — terminal
   * copy and paste, "Copy path", copy fingerprint, copy snippet, copy presigned
   * URL, copy file contents, copy proxy string. Unit tests could not catch it:
   * they stub `navigator.clipboard` outright, so the permission gate that
   * actually breaks it is never exercised.
   */
  test('the renderer can read and write the clipboard', async () => {
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText('luna-e2e-seed'));

    const read = await launched.page.evaluate(() =>
      navigator.clipboard.readText().catch((e: Error) => `REJECTED: ${e.message}`),
    );
    expect(read).toBe('luna-e2e-seed');

    const wrote = await launched.page.evaluate(() =>
      navigator.clipboard
        .writeText('luna-e2e-written')
        .then(() => 'ok')
        .catch((e: Error) => `REJECTED: ${e.message}`),
    );
    expect(wrote).toBe('ok');

    // Confirm it reached the real clipboard, not just a resolved promise.
    const onClipboard = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(onClipboard).toBe('luna-e2e-written');
  });

  test('still denies every permission that is not clipboard', async () => {
    // The allowlist must stay an allowlist. If this starts passing for camera,
    // the handler has been widened to allow-all.
    const states = await launched.page.evaluate(async () => {
      const names = ['camera', 'microphone', 'geolocation', 'notifications'];
      const out: Record<string, string> = {};
      for (const name of names) {
        try {
          const status = await navigator.permissions.query({ name: name as PermissionName });
          out[name] = status.state;
        } catch (e) {
          out[name] = `unsupported: ${(e as Error).name}`;
        }
      }
      return out;
    });

    for (const [name, state] of Object.entries(states)) {
      expect(state, `${name} should not be granted`).not.toBe('granted');
    }
  });
});

test.describe('renderer interaction', () => {
  test('opens the command palette from the keyboard', async () => {
    const { page } = launched;
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByPlaceholder('Type a command...')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder('Type a command...')).not.toBeVisible();
  });
});
