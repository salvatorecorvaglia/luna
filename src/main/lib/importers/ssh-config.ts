import type { ExportedConnection } from '@shared/types/connection';
import * as os from 'os';
import * as path from 'path';

/**
 * Parses local SSH config file contents and returns connection structures
 * ready for import into the SQLite connection database.
 */
export function parseSshConfig(content: string): ExportedConnection[] {
  const connections: ExportedConnection[] = [];
  const lines = content.split(/\r?\n/);

  let currentHost: Partial<ExportedConnection> = {};

  const finishCurrentHost = () => {
    if (currentHost.name && currentHost.host) {
      connections.push({
        name: currentHost.name,
        provider: 'sftp', // Imported hosts default to SFTP (SSH transfer)
        folder: 'ssh-config', // Group in default folder for organizational clarity
        host: currentHost.host,
        port: currentHost.port || 22,
        username: currentHost.username || os.userInfo().username || 'root',
        authType: currentHost.privateKeyPath ? 'key' : 'password',
        privateKeyPath: currentHost.privateKeyPath || undefined,
        isHidden: false,
      } as ExportedConnection);
    }
    currentHost = {};
  };

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Matches e.g. "HostName example.com" or "HostName = example.com"
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=?\s*(.+)$/);
    if (!match) continue;

    const command = match[1].toLowerCase();
    const value = match[2].trim().replace(/^["']|["']$/g, '');

    if (command === 'host') {
      finishCurrentHost();
      // Skip hosts that contain wildcard characters (* or ?)
      if (value.includes('*') || value.includes('?')) {
        continue;
      }
      currentHost.name = value;
    } else if (currentHost.name) {
      if (command === 'hostname') {
        currentHost.host = value;
      } else if (command === 'user') {
        currentHost.username = value;
      } else if (command === 'port') {
        const p = parseInt(value, 10);
        if (!Number.isNaN(p)) {
          currentHost.port = p;
        }
      } else if (command === 'identityfile') {
        let filePath = value;
        if (filePath.startsWith('~/')) {
          filePath = path.join(os.homedir(), filePath.slice(2));
        } else if (filePath === '~') {
          filePath = os.homedir();
        }
        currentHost.privateKeyPath = filePath;
      }
    }
  }

  finishCurrentHost();
  return connections;
}
