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
    // The auto-updater already no-ops when `app.isPackaged` is false, which it
    // is when launching from source like this — so no network access to
    // suppress and no extra env flag to invent.
    env: { ...process.env },
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
