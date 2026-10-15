import * as os from 'node:os';
import * as path from 'node:path';
import type { ExportedConnection } from '@shared/types/connection';

/**
 * Parses local SSH config file contents and returns connection structures
 * ready for import into the SQLite connection database.
 */
function getSystemUsername(): string {
  try {
    return os.userInfo().username || 'root';
  } catch {
    return process.env.USER || process.env.USERNAME || 'root';
  }
}

export function parseSshConfig(content: string): ExportedConnection[] {
  const connections: ExportedConnection[] = [];
  const lines = content.split(/\r?\n/);

  let currentHost: Partial<ExportedConnection> = {};

  const finishCurrentHost = () => {
    if (currentHost.name) {
      connections.push({
        name: currentHost.name,
        provider: 'sftp', // Imported hosts default to SFTP (SSH transfer)
        folder: 'ssh-config', // Group in default folder for organizational clarity
        // With no HostName, OpenSSH connects to the alias itself (`Host
        // myserver.example.com`). Such entries were silently dropped.
        host: currentHost.host ?? currentHost.name,
        port: currentHost.port || 22,
        username: currentHost.username || getSystemUsername(),
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

    // Non-null: both capture groups use `+`, so a match guarantees both exist.
    const command = match[1]!.toLowerCase();
    const value = match[2]!.trim().replace(/^["']|["']$/g, '');

    if (command === 'host') {
      finishCurrentHost();
      // `Host a b` declares two aliases for one block. Use the first concrete
      // one; the whole string ("a b") is neither a usable name nor hostname.
      // Pattern-only blocks (`Host *`, `Host *.corp`) configure other hosts
      // and are skipped.
      const alias = value
        .split(/\s+/)
        .find(
          (token) =>
            token && !token.includes('*') && !token.includes('?') && !token.startsWith('!'),
        );
      if (alias) currentHost.name = alias;
    } else if (command === 'match') {
      // A Match block's options apply conditionally to *other* hosts. Without
      // this they were applied to whichever Host block preceded it.
      finishCurrentHost();
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
