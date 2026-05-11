import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

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

    const host = section['HostName'];
    if (!host) continue;

    const username = section['UserName'] || '';
    let port = 22;
    if (section['PortNumber']) {
      // Handle dword:00000016 format
      if (section['PortNumber'].startsWith('dword:')) {
        port = parseInt(section['PortNumber'].replace('dword:', ''), 16);
      } else {
        port = parseInt(section['PortNumber'], 10) || 22;
      }
    }

    const privateKeyPath = section['PublicKeyFile'] || undefined;

    connections.push({
      name: decodeURIComponent(name), // PuTTY registry keys are often URL-encoded
      provider: 'sftp',
      host: host.replace(/^"(.*)"$/, '$1'), // Remove quotes if present
      port,
      username: username.replace(/^"(.*)"$/, '$1'),
      authType: privateKeyPath ? 'key' : 'password',
      privateKeyPath: privateKeyPath ? privateKeyPath.replace(/^"(.*)"$/, '$1') : undefined,
      folder: 'PuTTY',
    });
  }

  return connections;
}
