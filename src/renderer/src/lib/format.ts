/** Format a byte count as a short human-readable string ("1.5 KB", "12 B"). */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format a byte/sec rate, e.g. "12 KB/s". Returns "—" for non-positive rates. */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${formatSize(bytesPerSec)}/s`;
}

/** Estimated time-to-arrival in human-readable form, or null if not knowable. */
export function formatEta(remainingBytes: number, bytesPerSec: number): string | null {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0 || remainingBytes <= 0) return null;
  const seconds = Math.round(remainingBytes / bytesPerSec);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Format a unix timestamp (seconds) — short form for current year, full date otherwise. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isThisYear) {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
