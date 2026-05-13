import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

/**
 * MobaXterm session string format (SSH = `#109#`):
 *   #109#0%host%port%username%...%key_path%...%gw_host%gw_port%gw_user%...
 *
 * The exact indices drift between MobaXterm versions, but the slice we care
 * about is stable enough for the common cases:
 *
 *   parts[1]  host
 *   parts[2]  port
 *   parts[3]  username
 *   parts[14] private key path
 *   parts[18] gateway/jump host
 *   parts[19] gateway port
 *   parts[20] gateway username
 */
export function importFromMobaXterm(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

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

      // Gateway / jump host. Positional indices drift between MobaXterm versions
      // (often 17-19 or 19-21). We use a heuristic: scan from index 17 for a
      // non-empty field that looks like a host (contains dot/colon or length > 3)
      // followed by a valid port number.
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
          (candidateHost.includes('.') || candidateHost.includes(':') || candidateHost.length > 3)
        ) {
          gwHost = candidateHost;
          gwPort = candidatePort;
          gwUser = parts[i + 2]?.trim() || username;
          break;
        }
      }

      let jumpHostConfig: ExportedConnection['jumpHostConfig'];

      if (gwHost) {
        jumpHostConfig = {
          host: gwHost,
          port: gwPort || 22,
          username: gwUser || username,
          authType: 'password',
        };
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
        jumpHostConfig,
      });
    }
  }

  return connections;
}
