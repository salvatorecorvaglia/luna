import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

export function importFromWinSCP(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  const gatewayNames = new Map<string, string>();
  const gatewayConnections: ExportedConnection[] = [];

  for (const [sectionName, section] of Object.entries(ini)) {
    if (!sectionName.startsWith('Sessions\\')) continue;

    const name = sectionName.replace('Sessions\\', '');
    const host = section['HostName'];
    if (!host) continue;

    const protocol = parseInt(section['FSProtocol'], 10);
    if (protocol !== 0 && protocol !== 5) continue;

    const username = section['UserName'] || '';
    const port = parseInt(section['PortNumber'], 10) || (protocol === 0 ? 22 : 443);
    const privateKeyPath = section['PublicKeyFile'] || undefined;

    let jumpHostName: string | undefined;
    // WinSCP Tunnel: TunnelMethod=1 means SSH tunnel
    if (parseInt(section['TunnelMethod'], 10) === 1) {
      const gwHost = section['TunnelHostName'] || '';
      const gwPort = parseInt(section['TunnelPortNumber'], 10) || 22;
      const gwUser = section['TunnelUserName'] || username;
      const tupleKey = `${gwUser}@${gwHost}:${gwPort}`;

      jumpHostName = gatewayNames.get(tupleKey);
      if (!jumpHostName) {
        jumpHostName = `Jump: ${tupleKey}`;
        gatewayNames.set(tupleKey, jumpHostName);
        gatewayConnections.push({
          name: jumpHostName,
          provider: 'sftp',
          host: gwHost,
          port: gwPort,
          username: gwUser,
          authType: 'password',
          folder: 'Infrastructure',
          isHidden: true,
        });
      }
    }

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
        jumpHostName,
      });
    } else if (protocol === 5) {
      connections.push({
        name,
        provider: 's3',
        endpoint: host,
        folder: 'WinSCP',
        jumpHostName,
      });
    }
  }

  return [...gatewayConnections, ...connections];
}
