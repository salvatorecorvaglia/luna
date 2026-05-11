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
    for (const [name, value] of Object.entries(section)) {
      if (name === 'SubPath') continue;

      // SSH/SFTP sessions start with #109#
      if (value.startsWith('#109#')) {
        const parts = value.split('%');
        if (parts.length < 4) continue;

        const host = parts[1];
        const port = parseInt(parts[2], 10) || 22;
        const username = parts[3];

        connections.push({
          name,
          provider: 'sftp',
          host,
          port,
          username,
          authType: 'password', // Default, user will have to enter password
          folder: sectionName.includes('_') ? sectionName : 'MobaXterm',
        });
      }
    }
  }

  return connections;
}
