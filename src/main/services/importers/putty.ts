import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

/**
 * Read a field from a PuTTY session section, whichever export it came from.
 *
 * A registry export (`reg export … putty.reg`) quotes every key and string
 * value — `"HostName"="example.com"` — and escapes backslashes in paths as
 * `\\`. Only the unquoted `HostName=` form was recognised, so real `.reg`
 * files imported nothing at all.
 */
function field(section: Record<string, string>, key: string): string | undefined {
  const raw = section[key] ?? section[`"${key}"`];
  if (raw === undefined) return undefined;
  const quoted = raw.match(/^"(.*)"$/s);
  return quoted ? quoted[1]!.replace(/\\(["\\])/g, '$1') : raw;
}

export function importFromPuTTY(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  for (const [sectionName, section] of Object.entries(ini)) {
    // Check for .reg format or Unix session format
    // Registry: [HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\NAME]
    // Unix: Just a file, but parseIni might put it in [default]

    let name = sectionName;
    if (sectionName.includes('PuTTY\\Sessions\\')) {
      name = sectionName.split('PuTTY\\Sessions\\').pop() || sectionName;
    }

    const host = field(section, 'HostName');
    if (!host) continue;

    const username = field(section, 'UserName') || '';
    let port = 22;
    const portField = field(section, 'PortNumber');
    if (portField) {
      // Handle dword:00000016 format
      if (portField.startsWith('dword:')) {
        port = parseInt(portField.replace('dword:', ''), 16);
      } else {
        port = parseInt(portField, 10) || 22;
      }
    }

    const privateKeyPath = field(section, 'PublicKeyFile') || undefined;

    let decodedName = name;
    try {
      decodedName = decodeURIComponent(name);
    } catch {
      // Keep original name if decoding throws a URIError
    }

    connections.push({
      name: decodedName, // PuTTY registry keys are often URL-encoded
      provider: 'sftp',
      host,
      port,
      username,
      authType: privateKeyPath ? 'key' : 'password',
      privateKeyPath,
      folder: 'PuTTY',
    });
  }

  return connections;
}
