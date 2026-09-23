/**
 * Where Luna's releases live.
 *
 * Hard-coded rather than passed in from the renderer or read from a feed:
 * both consumers hand these URLs to something with real authority — the OS
 * (`shell.openExternal`) and the self-updater (which unpacks what it fetches
 * over the running app bundle) — so a compromised renderer must never get to
 * choose them.
 */
const OWNER = 'salvatorecorvaglia';
const REPO = 'luna';

/** Human-facing page: the fallback when a build cannot update itself at all. */
export const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** Origin every update byte must come from. Checked before a download starts. */
export const RELEASE_ASSET_ORIGIN = 'https://github.com';

/**
 * Download URL of one asset attached to the `v<version>` release.
 *
 * `assetName` comes from `latest-mac.yml` (itself fetched over HTTPS by
 * electron-updater), so it is encoded rather than interpolated raw — a name
 * containing `../` or a query string must not be able to reshape the URL.
 */
export function releaseAssetUrl(version: string, assetName: string): string {
  const tag = encodeURIComponent(`v${version}`);
  return `${RELEASE_ASSET_ORIGIN}/${OWNER}/${REPO}/releases/download/${tag}/${encodeURIComponent(assetName)}`;
}
