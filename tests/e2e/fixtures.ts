import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test';

/**
 * Launch the built app against a throwaway userData directory.
 *
 * Isolation matters more than usual here: Luna's userData holds the SQLite
 * database, the credential-store master key and the known_hosts table. A test
 * run that reused the developer's real profile could migrate it, drop rows
 * during a delete-all, or overwrite a trusted host key.
 */
export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

/**
 * Environment variables that must never reach the launched app. See the comment
 * at the `env:` option below for why each one is here.
 */
const STRIPPED_ENV_VARS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'] as const;

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if ((STRIPPED_ENV_VARS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  return env;
}

export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'luna-e2e-'));

  const app = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${userDataDir}`,
      // CI containers have no sandbox support; the app's own dev script
      // passes the same flag.
      '--no-sandbox',
    ],
    // Inherit the developer's environment, minus the two variables that would
    // stop Electron being Electron.
    //
    // `ELECTRON_RUN_AS_NODE` is set by every Electron-hosted terminal (VS Code's
    // integrated terminal, the Claude Code extension, Cursor). Forwarding it made
    // `electron.launch()` boot the app as a plain Node process: `require('electron')`
    // resolves to the stub, `app` is `undefined`, the module body throws on
    // `app.isPackaged`, no window is ever created, and `firstWindow()` hangs until
    // the 60s hook timeout — pointing the failure at the launch call rather than at
    // the environment. The whole suite was unrunnable from those terminals.
    //
    // `NODE_OPTIONS` is stripped for the same class of reason: the packaged app
    // disables it via an Electron fuse, so honouring it here would test a
    // configuration production never runs.
    env: sanitizedEnv(),
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userDataDir };
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close().catch(() => {
    /* already gone */
  });
  rmSync(launched.userDataDir, { recursive: true, force: true });
}
