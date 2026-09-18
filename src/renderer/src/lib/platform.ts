/**
 * Platform detection for keyboard-chord labelling and modifier choice.
 *
 * Centralised because three components each rolled their own
 * `/Mac|iPhone|iPad|iPod/.test(navigator.platform)` — and `navigator.platform`
 * is deprecated, so any future change had three places to miss.
 *
 * Prefers `navigator.userAgentData.platform` where the browser provides it and
 * falls back to the legacy property, which Electron still populates.
 */
interface UserAgentData {
  platform?: string;
}

function rawPlatform(): string {
  if (typeof navigator === 'undefined') return '';
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  return uaData?.platform || navigator.platform || '';
}

/** True on macOS (and iPadOS, which reports as a Mac). */
export const isMac = /Mac|iPhone|iPad|iPod/i.test(rawPlatform());

export const isLinux = /Linux/i.test(rawPlatform());

/**
 * The primary chord modifier symbol for this platform, for display in
 * shortcut hints: `⌘` on macOS, `Ctrl` elsewhere.
 */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
