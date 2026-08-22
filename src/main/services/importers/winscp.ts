import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

function parseRegInt(val: string | undefined | null, defaultValue: number): number {
  if (!val) return defaultValue;
  if (val.startsWith('dword:')) {
    const parsed = parseInt(val.replace('dword:', ''), 16);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function importFromWinSCP(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  for (const [sectionName, section] of Object.entries(ini)) {
    if (!sectionName.startsWith('Sessions\\')) continue;

    const name = sectionName.replace('Sessions\\', '');
    const host = section['HostName'];
    if (!host) continue;

    const protocol = parseRegInt(section['FSProtocol'], -1);
    if (protocol !== 0 && protocol !== 5) continue;

    const username = section['UserName'] || '';
    const port = parseRegInt(section['PortNumber'], protocol === 0 ? 22 : 443);
    const privateKeyPath = section['PublicKeyFile'] || undefined;

    if (protocol === 0) {
      connections.push({
        name,
        provider: 'sftp',
        host,
        port,
        username,
        authType: privateKeyPath ? 'key' : 'password',
        privateKeyPath,
        folder: 'WinSCP',
      });
    } else if (protocol === 5) {
      connections.push({
        name,
        provider: 's3',
        endpoint: host,
        folder: 'WinSCP',
      });
    }
  }

  return connections;
}
