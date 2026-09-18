import type { ExportedConnection } from '@shared/types/connection';
import { importFromMobaXterm } from './mobaxterm';
import { importFromPuTTY } from './putty';
import { importFromWinSCP } from './winscp';

/**
 * Luna's own export format: a JSON array of ExportedConnection, or an object
 * with a `connections` array.
 *
 * This branch was missing entirely even though the import dialog advertises
 * `json` as its *first* accepted extension, so re-importing a file produced by
 * `exportConnections()` fell through to the `return []` at the bottom and
 * reported "0 imported, 0 skipped" with no error. Round-tripping your own
 * export is the most obvious thing a user will try.
 */
function tryParseLunaJson(content: string): ExportedConnection[] | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { connections?: unknown })?.connections)
      ? (parsed as { connections: unknown[] }).connections
      : null;
  if (!list) return null;
  // Shape-check only enough to know this is ours; `importConnections` does the
  // real per-field validation and reports rejects through `skipped`.
  return list.filter(
    (c): c is ExportedConnection =>
      typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string',
  );
}

export function detectAndImport(content: string, fileName: string): ExportedConnection[] {
  const lowerName = fileName.toLowerCase();

  const lunaJson = tryParseLunaJson(content);
  if (lunaJson) return lunaJson;

  // Try to detect by content or extension
  if (
    content.includes('#109#') ||
    lowerName.endsWith('.mxtpro') ||
    lowerName.endsWith('.mxtsessions')
  ) {
    return importFromMobaXterm(content);
  }

  if (
    content.includes('SimonTatham\\PuTTY') ||
    (content.includes('HostName=') && content.includes('PortNumber='))
  ) {
    // This could be PuTTY or WinSCP, they share similar keys
    if (content.includes('FSProtocol=')) {
      return importFromWinSCP(content);
    }
    return importFromPuTTY(content);
  }

  // Fallback to WinSCP if it looks like an INI with Sessions
  if (content.includes('[Sessions\\')) {
    return importFromWinSCP(content);
  }

  return [];
}
