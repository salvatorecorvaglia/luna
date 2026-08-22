import type { ExportedConnection } from '@shared/types/connection';
import { parseIni } from './ini-parser';

/**
 * MobaXterm session string format (SSH = `#109#`):
 *   #109#0%host%port%username%...%key_path%...
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

  return connections;
}
