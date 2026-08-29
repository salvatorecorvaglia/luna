import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedNavigation } from '../../../src/main/lib/navigation-guard';

const ENTRY = '/Applications/Luna.app/Contents/Resources/app.asar/out/renderer/index.html';
const entryUrl = pathToFileURL(ENTRY).href;

describe('isAllowedNavigation', () => {
  it('allows the bundled renderer entry point', () => {
    expect(isAllowedNavigation(entryUrl, ENTRY)).toBe(true);
  });

  it('allows the entry point with a fragment or query', () => {
    // Hash/search are not part of the path and must not flip the verdict.
    expect(isAllowedNavigation(`${entryUrl}#/settings`, ENTRY)).toBe(true);
    expect(isAllowedNavigation(`${entryUrl}?v=2`, ENTRY)).toBe(true);
  });

  // The regression this guard exists for. The previous implementation only
  // checked `protocol !== 'file:'`, and in a packaged build the app IS file://
  // — so every one of these was permitted, and each would have loaded with the
  // preload attached (full window.api) and no CSP.
  it.each([
    ['a sibling file in the same directory', '/Contents/Resources/app.asar/out/renderer/evil.html'],
    ['an arbitrary path on disk', '/tmp/evil.html'],
    ['the user home directory', '/Users/someone/Downloads/invoice.html'],
    ['a path that merely starts with the entry path', `${ENTRY}.evil.html`],
  ])('blocks %s', (_label, path) => {
    expect(isAllowedNavigation(pathToFileURL(path).href, ENTRY)).toBe(false);
  });

  it('blocks traversal that resolves outside the entry point', () => {
    const traversal = pathToFileURL(
      '/Applications/Luna.app/Contents/Resources/app.asar/out/renderer/../../../../../../tmp/evil.html',
    ).href;
    expect(isAllowedNavigation(traversal, ENTRY)).toBe(false);
  });

  it.each([
    ['remote http', 'http://evil.test/'],
    ['remote https', 'https://evil.test/'],
    ['data URL', 'data:text/html,<script>1</script>'],
    ['javascript URL', 'javascript:alert(1)'],
    ['custom protocol', 'luna://open'],
    ['unparseable input', 'not a url at all'],
  ])('blocks %s', (_label, url) => {
    expect(isAllowedNavigation(url, ENTRY)).toBe(false);
  });

  describe('dev renderer', () => {
    const DEV = 'http://localhost:5173';

    it('allows the Vite dev origin when it is configured', () => {
      expect(isAllowedNavigation(`${DEV}/index.html`, ENTRY, DEV)).toBe(true);
    });

    it('blocks a different host even while dev mode is on', () => {
      expect(isAllowedNavigation('http://evil.test/', ENTRY, DEV)).toBe(false);
    });

    it('blocks a different port on the same host', () => {
      expect(isAllowedNavigation('http://localhost:9999/', ENTRY, DEV)).toBe(false);
    });

    it('blocks the dev origin in production, where it is undefined', () => {
      expect(isAllowedNavigation(`${DEV}/index.html`, ENTRY)).toBe(false);
    });
  });
});
