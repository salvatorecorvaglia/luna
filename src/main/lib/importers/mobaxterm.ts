import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

/**
 * MobaXterm session string format (SSH = `#109#`):
 *   #109#0%host%port%username%...%key_path%...%gw_host%gw_port%gw_user%...
 */
export function importFromMobaXterm(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  const gatewayNames = new Map<string, string>();
  const gatewayConnections: ExportedConnection[] = [];
  const takenNames = new Set<string>();

  // Pre-scan bookmark names
  for (const sectionName of Object.keys(ini)) {
    if (!sectionName.toLowerCase().startsWith('bookmarks')) continue;
    for (const name of Object.keys(ini[sectionName])) {
      if (!['SubRep', 'ImgNum', 'SubPath'].includes(name)) takenNames.add(name);
    }
  }

  function uniqueGatewayName(base: string): string {
    let candidate = base;
    let n = 2;
    while (takenNames.has(candidate)) {
      candidate = `${base} (${n})`;
      n++;
    }
    takenNames.add(candidate);
    return candidate;
  }

  function translateMobaPath(input: string): string {
    return input
      .replace(/_ProfileDir_\\\.ssh\\/gi, '~/.ssh/')
      .replace(/_ProfileDir_/gi, '~')
      .replace(/_CurrentDrive_:/gi, '')
      .replace(/\\/g, '/');
  }

  for (const sectionName of Object.keys(ini)) {
    if (!sectionName.toLowerCase().startsWith('bookmarks')) continue;

    const section = ini[sectionName];
    const folder = section.SubRep || (sectionName.includes('_') ? sectionName : 'MobaXterm');

    for (const [name, value] of Object.entries(section)) {
      if (['SubRep', 'ImgNum', 'SubPath'].includes(name)) continue;
      if (!value.startsWith('#109#')) continue;

      const parts = value.split('%');
      if (parts.length < 4) continue;

      const host = parts[1];
      const port = parseInt(parts[2], 10) || 22;
      const username = parts[3];

      const rawKey = parts[14];
      const privateKeyPath = rawKey ? translateMobaPath(rawKey) : undefined;

      // Gateway / jump host heuristic search
      let gwHost: string | undefined;
      let gwPort: number | undefined;
      let gwUser: string | undefined;

      for (let i = 17; i < parts.length - 2; i++) {
        const candidateHost = parts[i]?.trim();
        if (!candidateHost || candidateHost === '0' || candidateHost === '1') continue;

        const candidatePort = parseInt(parts[i + 1], 10);
        if (
          !isNaN(candidatePort) &&
          candidatePort > 0 &&
          candidatePort <= 65535 &&
          !candidateHost.includes('#') && // Exclude font/UI settings like "MobaFont:10"
          (candidateHost.includes('.') || candidateHost.includes(':') || candidateHost.length > 3)
        ) {
          gwHost = candidateHost;
          gwPort = candidatePort;
          gwUser = parts[i + 2]?.trim() || username;
          break;
        }
      }

      let jumpHostName: string | undefined;
      if (gwHost) {
        const tupleKey = `${gwUser}@${gwHost}:${gwPort}`;
        jumpHostName = gatewayNames.get(tupleKey);
        if (!jumpHostName) {
          jumpHostName = uniqueGatewayName(`Jump: ${tupleKey}`);
          gatewayNames.set(tupleKey, jumpHostName);
          gatewayConnections.push({
            name: jumpHostName,
            provider: 'sftp',
            host: gwHost,
            port: gwPort || 22,
            username: gwUser || username,
            authType: 'password',
            folder: 'Infrastructure',
            isHidden: true, // Hide from sidebar
          });
        }
      }

      connections.push({
        name,
        provider: 'sftp',
        host,
        port,
        username,
        authType: privateKeyPath ? 'key' : 'password',
        privateKeyPath: privateKeyPath || undefined,
        folder,
        jumpHostName,
      });
    }
  }

  return [...gatewayConnections, ...connections];
}
