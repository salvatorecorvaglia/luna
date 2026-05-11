import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

export function importFromWinSCP(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  for (const [sectionName, section] of Object.entries(ini)) {
    if (!sectionName.startsWith('Sessions\\')) continue;

    const name = sectionName.replace('Sessions\\', '');
    const host = section['HostName'];
    if (!host) continue;

    // WinSCP Protocol: 0 = SFTP, 1 = SCP, 2 = FTP, 5 = S3
    const protocol = parseInt(section['FSProtocol'], 10);

    // We only support SFTP (0) and S3 (5) currently
    if (protocol !== 0 && protocol !== 5) continue;

    const username = section['UserName'] || '';
    const port = parseInt(section['PortNumber'], 10) || (protocol === 0 ? 22 : 443);
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
