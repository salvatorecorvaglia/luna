import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Decides whether the renderer is allowed to navigate to `url`.
 *
 * Why this is not just a protocol check: in a packaged build the app itself is
 * served from `file://`, so a `protocol !== 'file:'` guard permits top-level
 * navigation to *any* local HTML file. The preload is bound to the WebContents
 * rather than to a URL, so such a document inherits the entire `window.api`
 * surface — SSH connect, credential reads, home-directory file I/O — and, since
 * the production CSP is delivered as a response header on the app's own load,
 * it arrives with no CSP at all. That turns any renderer scripting bug into
 * persistent, unrestricted access to the IPC bridge.
 *
 * So the rule is an allowlist of exactly two documents: the bundled renderer
 * entry point, and (in development only) the Vite dev server origin.
 *
 * Extracted from `main/index.ts` so it can be unit-tested — that module runs
 * `app.requestSingleInstanceLock()` and installs process handlers at import
 * time, which makes it impractical to import from a test.
 *
 * @param url            The navigation target, as handed to `will-navigate`.
 * @param rendererEntry  Absolute path to the bundled `index.html`.
 * @param devRendererUrl `ELECTRON_RENDERER_URL` when running under Vite, else undefined.
 */
export function isAllowedNavigation(
  url: string,
  rendererEntry: string,
  devRendererUrl?: string,
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Unparseable input is not something we can reason about — refuse it.
    return false;
  }

  if (devRendererUrl && devRendererUrl.startsWith(`${u.protocol}//${u.host}`)) {
    return true;
  }

  if (u.protocol !== 'file:') return false;

  let filePath: string;
  try {
    // Drop search/hash before converting: they are not part of the path, and an
    // in-page fragment must not change the verdict.
    const bare = new URL(u.href);
    bare.search = '';
    bare.hash = '';
    filePath = resolvePath(fileURLToPath(bare));
  } catch {
    return false;
  }

  // Windows paths are case-insensitive; everywhere else an exact match is both
  // the stricter and the correct comparison.
  return process.platform === 'win32'
    ? filePath.toLowerCase() === resolvePath(rendererEntry).toLowerCase()
    : filePath === resolvePath(rendererEntry);
}
