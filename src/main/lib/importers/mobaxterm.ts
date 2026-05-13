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
 *   parts[14] private key path (already in use by this importer)
 *   parts[18] gateway/jump host
 *   parts[19] gateway port
 *   parts[20] gateway username
 *
 * When a gateway is present, the importer synthesizes a separate
 * ExportedConnection for the bastion (deduped across targets that share the
 * same gateway tuple) and links the target via `jumpHostName`. The db.ipc
 * import path's second pass then turns that name into a real FK on insert.
 */
export function importFromMobaXterm(content: string): ExportedConnection[] {
  const ini = parseIni(content);
  const connections: ExportedConnection[] = [];

  /**
   * gateway tuple → synthetic-bastion connection name. Lets multiple targets
   * pointing at the same `(host, port, user)` gateway share one bastion row.
   */
  const gatewayNames = new Map<string, string>();
  /** Synthesized bastion connections, emitted *before* their dependents. */
  const gatewayConnections: ExportedConnection[] = [];
  /** Names already taken in the import payload (existing bookmark names +
   *  previously-synthesized gateways) so we can resolve collisions. */
  const takenNames = new Set<string>();

  // Pre-scan bookmark names so synthetic gateway labels won't collide.
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

      // Gateway / jump host. MobaXterm leaves these empty when no jump is
      // configured, so we treat empty / missing as "no gateway".
      const gwHostRaw = parts[18];
      const gwPortRaw = parts[19];
      const gwUserRaw = parts[20];
      let jumpHostName: string | undefined;
      if (gwHostRaw && gwHostRaw.trim() !== '') {
        const gwHost = gwHostRaw.trim();
        const gwPort = parseInt(gwPortRaw, 10) || 22;
        const gwUser = (gwUserRaw && gwUserRaw.trim()) || username;
        const tupleKey = `${gwUser}@${gwHost}:${gwPort}`;
        let synthName = gatewayNames.get(tupleKey);
        if (!synthName) {
          synthName = uniqueGatewayName(`Jump: ${tupleKey}`);
          gatewayNames.set(tupleKey, synthName);
          gatewayConnections.push({
            name: synthName,
            provider: 'sftp',
            host: gwHost,
            port: gwPort,
            username: gwUser,
            // Mobaxterm doesn't surface the gateway's auth config in this
            // string. Default to password — users will need to fill in
            // credentials post-import. The import summary makes this
            // obvious because the bastion appears as its own connection.
            authType: 'password',
            folder,
          });
        }
        jumpHostName = synthName;
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

  // Emit gateways first so the in-batch link resolver finds them when it
  // processes targets in source order.
  return [...gatewayConnections, ...connections];
}
