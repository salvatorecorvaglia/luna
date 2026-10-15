import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Browser,
  chromium,
  type ElectronApplication,
  _electron as electron,
  type Page,
} from '@playwright/test';

/**
 * Launch the app against a throwaway userData directory.
 *
 * Isolation matters more than usual here: Luna's userData holds the SQLite
 * database, the credential-store master key and the known_hosts table. A test
 * run that reused the developer's real profile could migrate it, drop rows
 * during a delete-all, or overwrite a trusted host key.
 *
 * Two modes:
 *
 * - **Unpackaged** (default): `electron .` against `out/`, driven through
 *   Playwright's Electron launcher, which also gives `app` — main-process
 *   evaluation for the tests that need it.
 * - **Packaged** (`LUNA_E2E_EXECUTABLE=<path to the built binary>`): the real
 *   electron-builder output, so the asar, the asar-unpacked native modules,
 *   the fuses and the `app.isPackaged` branches (CSP header, menu, lenient
 *   rejection handling) are what's under test. Playwright's Electron launcher
 *   can't drive it — it always passes `--inspect=0`, which the
 *   `enableNodeCliInspectArguments: false` fuse refuses — so the renderer is
 *   reached over CDP via `--remote-debugging-port` instead, and `app` is
 *   `null`. Tests that need the main process skip themselves in this mode.
 */
export interface LaunchedApp {
  /** Main-process handle; `null` when driving a packaged build. */
  app: ElectronApplication | null;
  page: Page;
  userDataDir: string;
  /** Packaged mode only. */
  browser?: Browser;
  child?: ChildProcess;
}

/** Path to a packaged Luna binary, when the suite should run against one. */
export const packagedExecutable = process.env.LUNA_E2E_EXECUTABLE || null;

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

/**
 * macOS only: keep safeStorage off the developer's login keychain, for the same
 * reason userData is a temp dir. It also stops the run hanging: a rebuilt,
 * ad-hoc-signed binary no longer matches the ACL on the existing "Luna Safe
 * Storage" item, so macOS shows an access prompt that blocks the main thread
 * (no window, no DevTools endpoint, SIGTERM ignored) until someone clicks it.
 */
const PLATFORM_ARGS = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];

export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'luna-e2e-'));
  if (packagedExecutable) return launchPackaged(packagedExecutable, userDataDir);

  const app = await electron.launch({
    args: [
      '.',
      `--user-data-dir=${userDataDir}`,
      // CI containers have no sandbox support; the app's own dev script
      // passes the same flag.
      '--no-sandbox',
      ...PLATFORM_ARGS,
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

const DEVTOOLS_RE = /DevTools listening on (ws:\/\/\S+)/;

async function launchPackaged(executable: string, userDataDir: string): Promise<LaunchedApp> {
  const child = spawn(
    executable,
    [
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--remote-debugging-port=0',
      ...PLATFORM_ARGS,
    ],
    { env: sanitizedEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  try {
    const endpoint = await waitForDevToolsEndpoint(child);
    const browser = await chromium.connectOverCDP(endpoint);
    const page = await firstPage(browser);
    await page.waitForLoadState('domcontentloaded');
    return { app: null, page, userDataDir, browser, child };
  } catch (err) {
    // A failed launch must not leave the app running (and holding the
    // userData directory) behind the failing test run.
    await stopChild(child);
    rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }
}

function waitForDevToolsEndpoint(child: ChildProcess): Promise<string> {
  let output = '';
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`packaged app printed no DevTools endpoint within 30s:\n${output}`));
    }, 30_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const match = DEVTOOLS_RE.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`packaged app exited early (code ${code}, signal ${signal}):\n${output}`));
    });
  });
}

/** The window may not exist yet when CDP first connects. */
async function firstPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const page = browser.contexts().flatMap((c) => c.pages())[0];
    if (page) return page;
    if (Date.now() > deadline) throw new Error('packaged app opened no window within 30s');
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  if (launched.app) {
    await launched.app.close().catch(() => {
      /* already gone */
    });
  } else {
    await launched.browser?.close().catch(() => {
      /* already gone */
    });
    await stopChild(launched.child);
  }
  rmSync(launched.userDataDir, { recursive: true, force: true });
}

/** Ask the packaged app to quit, then insist: a hung quit must not hang the run. */
async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}
