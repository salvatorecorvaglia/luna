import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

/**
 * MobaXterm session string format:
 * #109#0%host%port%username%...
 */
export function importFromMobaXterm(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  // MobaXterm stores bookmarks in [Bookmarks] or [Bookmarks_1], etc.
  for (const sectionName of Object.keys(ini)) {
    if (!sectionName.toLowerCase().startsWith('bookmarks')) continue;

    const section = ini[sectionName];
    const folder = section.SubRep || (sectionName.includes('_') ? sectionName : 'MobaXterm');

    for (const [name, value] of Object.entries(section)) {
      if (['SubRep', 'ImgNum', 'SubPath'].includes(name)) continue;

      // SSH/SFTP sessions start with #109#
      if (value.startsWith('#109#')) {
        const parts = value.split('%');
        if (parts.length < 4) continue;

        const host = parts[1];
        const port = parseInt(parts[2], 10) || 22;
        const username = parts[3];
        
        // Key path is usually at index 14
        let privateKeyPath = parts[14];
        if (privateKeyPath) {
          // Translate MobaXterm internal variables
          // _ProfileDir_ is often where .ssh folder is kept
          privateKeyPath = privateKeyPath.replace(/_ProfileDir_\\\.ssh\\/gi, '~/.ssh/');
          privateKeyPath = privateKeyPath.replace(/_ProfileDir_/gi, '~');
          privateKeyPath = privateKeyPath.replace(/_CurrentDrive_:/gi, '');
          // Convert backslashes to forward slashes for cross-platform compatibility
          privateKeyPath = privateKeyPath.replace(/\\/g, '/');
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
        });
      }
    }
  }

  return connections;
}
