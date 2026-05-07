import { dialog, ipcMain } from 'electron';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { expandAndConfineToHomeSync } from '../lib/validate';
import { IPC, LIMITS } from '@shared/constants';
import { type ConnectionRow, getDatabase } from '../services/database';
import { transferQueue } from '../services/transfer-queue';
import type {
  Connection,
  CreateConnectionInput,
  ExportedConnection,
  UpdateConnectionInput,
} from '@shared/types/connection';
import { deleteCredential, storeCredential } from '../services/credential-store';
import type { AppSettings } from '@shared/types/settings';

const VALID_AUTH_TYPES = ['password', 'key', 'key+passphrase'] as const;

/** Per-key value type guards. Values arrive from the renderer as JSON-encoded
 * strings (`'14'`, `'"dracula"'`, `'true'`); after parsing we enforce shape so
 * a misbehaving renderer can't poison the settings table with a type the rest
 * of the app doesn't expect. */
type SettingTypeName = 'string' | 'number' | 'boolean';
const SETTING_TYPES: Record<keyof AppSettings, SettingTypeName> = {
  'terminal.fontFamily': 'string',
  'terminal.fontSize': 'number',
  'terminal.theme': 'string',
  'terminal.scrollback': 'number',
  'transfer.concurrency': 'number',
  'ssh.autoReconnect': 'boolean',
  'ssh.keepAliveInterval': 'number',
  'ssh.maxReconnectAttempts': 'number',
  'ssh.readyTimeout': 'number',
  'ui.applyTerminalTheme': 'boolean',
};
const VALID_SETTINGS_KEYS = new Set(Object.keys(SETTING_TYPES));

function checkSettingType(key: string, parsed: unknown): boolean {
  const expected = SETTING_TYPES[key as keyof AppSettings];
  if (!expected) return false;
  if (expected === 'number') return typeof parsed === 'number' && Number.isFinite(parsed);
  return typeof parsed === expected;
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider ?? 'sftp',
    host: row.host ?? '',
    port: row.port ?? 22,
    username: row.username ?? '',
    authType: row.auth_type ?? 'password',
    privateKeyPath: row.private_key_path || undefined,
    endpoint: row.endpoint || undefined,
    region: row.region || undefined,
    defaultBucket: row.default_bucket || undefined,
    forcePathStyle: row.force_path_style == null ? undefined : row.force_path_style === 1,
    folder: row.folder,
    colorTag: row.color_tag || undefined,
    lastConnectedAt: row.last_connected_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerDbHandlers(): void {
  const db = getDatabase();

  ipcMain.handle(IPC.CONNECTION_LIST, () => {
    const rows = db.prepare('SELECT * FROM connections ORDER BY name ASC').all() as ConnectionRow[];
    return rows.map(rowToConnection);
  });

  ipcMain.handle(IPC.CONNECTION_GET, (_event, id: string) => {
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as
      | ConnectionRow
      | undefined;
    return row ? rowToConnection(row) : null;
  });

  ipcMain.handle(IPC.CONNECTION_CREATE, (_event, input: CreateConnectionInput) => {
    if (!input.name?.trim()) throw new Error('Connection name is required');
    const provider = input.provider ?? 'sftp';

    if (provider === 'sftp') {
      if (!input.host?.trim()) throw new Error('Host is required');
      if (!input.username?.trim()) throw new Error('Username is required');
      if (typeof input.port !== 'number' || input.port < 1 || input.port > 65535) {
        throw new Error('Port must be between 1 and 65535');
      }
      if (!input.authType) throw new Error('authType is required');
    } else if (provider === 's3') {
      if (!input.accessKeyId?.trim()) throw new Error('Access Key ID is required');
      if (!input.secretAccessKey?.trim()) throw new Error('Secret Access Key is required');
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `
      INSERT INTO connections (
        id, name, provider, host, port, username, auth_type, private_key_path,
        endpoint, region, default_bucket, force_path_style,
        folder, color_tag, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.name,
      provider,
      provider === 'sftp' ? (input.host ?? null) : null,
      provider === 'sftp' ? (input.port ?? null) : null,
      provider === 'sftp' ? (input.username ?? null) : null,
      provider === 'sftp' ? (input.authType ?? null) : null,
      provider === 'sftp' ? input.privateKeyPath || null : null,
      provider === 's3' ? input.endpoint || null : null,
      provider === 's3' ? input.region || null : null,
      provider === 's3' ? input.defaultBucket || null : null,
      provider === 's3' ? (input.forcePathStyle ? 1 : 0) : null,
      input.folder || 'default',
      input.colorTag || null,
      now,
      now,
    );

    // Store credentials.
    // SFTP: a single secret string (password or passphrase).
    // S3: a JSON blob {accessKeyId, secretAccessKey, sessionToken?}.
    if (provider === 'sftp') {
      if (input.password) {
        storeCredential(id, input.password);
      } else if (input.passphrase) {
        storeCredential(id, input.passphrase);
      }
    } else if (provider === 's3') {
      storeCredential(
        id,
        JSON.stringify({
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
          sessionToken: input.sessionToken || undefined,
        }),
      );
    }

    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
    return rowToConnection(row);
  });

  // Whitelist of UpdateConnectionInput keys → DB column names. Only fields listed
  // here may be passed to the dynamic UPDATE; an explicit allow-list is safer than
  // trusting future contributors to keep the if-chain in sync with the SQL.
  const UPDATE_FIELD_MAP: Record<string, string> = {
    name: 'name',
    provider: 'provider',
    host: 'host',
    port: 'port',
    username: 'username',
    authType: 'auth_type',
    privateKeyPath: 'private_key_path',
    endpoint: 'endpoint',
    region: 'region',
    defaultBucket: 'default_bucket',
    forcePathStyle: 'force_path_style',
    folder: 'folder',
    colorTag: 'color_tag',
  };

  ipcMain.handle(IPC.CONNECTION_UPDATE, (_event, input: UpdateConnectionInput) => {
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(input.id) as
      | ConnectionRow
      | undefined;

    if (!existing) {
      throw new Error(`Connection not found: ${input.id}`);
    }

    const assignments: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    for (const [key, column] of Object.entries(UPDATE_FIELD_MAP)) {
      const raw = (input as unknown as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      let value: string | number | null;
      if (
        key === 'privateKeyPath' ||
        key === 'colorTag' ||
        key === 'endpoint' ||
        key === 'region' ||
        key === 'defaultBucket'
      ) {
        value = (raw as string) || null;
      } else if (key === 'forcePathStyle') {
        value = raw ? 1 : 0;
      } else {
        value = raw as string | number;
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    values.push(input.id);

    db.prepare(`UPDATE connections SET ${assignments.join(', ')} WHERE id = ?`).run(...values);

    // Update credentials. SFTP secrets are a plain string; S3 secrets are a
    // JSON blob carrying access key + secret + optional session token.
    const provider = input.provider ?? existing.provider ?? 'sftp';
    if (provider === 'sftp') {
      if (input.password) {
        storeCredential(input.id, input.password);
      } else if (input.passphrase) {
        storeCredential(input.id, input.passphrase);
      }
    } else if (provider === 's3' && (input.accessKeyId || input.secretAccessKey)) {
      storeCredential(
        input.id,
        JSON.stringify({
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
          sessionToken: input.sessionToken || undefined,
        }),
      );
    }

    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(input.id) as ConnectionRow;
    return rowToConnection(row);
  });

  ipcMain.handle(IPC.CONNECTION_DELETE, (_event, id: string) => {
    db.prepare('DELETE FROM connections WHERE id = ?').run(id);
    deleteCredential(id);
  });

  ipcMain.handle(IPC.CONNECTION_EXPORT, (): ExportedConnection[] => {
    const rows = db.prepare('SELECT * FROM connections ORDER BY name ASC').all() as ConnectionRow[];
    return rows.map((row) => {
      const out: ExportedConnection = { name: row.name, provider: row.provider ?? 'sftp' };
      if (row.host) out.host = row.host;
      if (row.port != null) out.port = row.port;
      if (row.username) out.username = row.username;
      if (row.auth_type) out.authType = row.auth_type;
      if (row.private_key_path) out.privateKeyPath = row.private_key_path;
      if (row.endpoint) out.endpoint = row.endpoint;
      if (row.region) out.region = row.region;
      if (row.default_bucket) out.defaultBucket = row.default_bucket;
      if (row.force_path_style != null) out.forcePathStyle = row.force_path_style === 1;
      if (row.folder && row.folder !== 'default') out.folder = row.folder;
      if (row.color_tag) out.colorTag = row.color_tag;
      return out;
    });
  });

  /**
   * Confine a privateKeyPath from an imported file to the user's home subtree.
   * Imports may originate from another machine — accept ~ expansion but reject
   * anything that resolves outside home. Returns null when the path can be
   * stored as-is (after canonicalization), or throws to signal "skip this row".
   * Cross-platform: uses validate.ts's home-confinement helper so a Windows
   * import from a macOS export doesn't slip past a POSIX-only prefix check.
   */
  function sanitizeImportedKeyPath(input: string | undefined | null): string | null {
    if (!input) return null;
    if (typeof input !== 'string') {
      throw new Error('privateKeyPath must be a string');
    }
    return expandAndConfineToHomeSync(input, 'privateKeyPath');
  }

  // Caps on import payloads. The renderer-side IPC channel accepts an arbitrary
  // array, so without these a misbehaving renderer (or a poisoned import file)
  // could insert millions of rows or megabyte-long names.
  const MAX_IMPORT_CONNECTIONS = 5_000;
  const MAX_IMPORT_FIELD_LEN = 1_024;
  function assertImportFieldLen(
    val: string | undefined | null,
    label: string,
    max = MAX_IMPORT_FIELD_LEN,
  ): void {
    if (typeof val === 'string' && val.length > max) {
      throw new Error(`${label} exceeds ${max} characters`);
    }
  }

  function importConnections(connections: ExportedConnection[]): {
    imported: number;
    skipped: { name: string; reason: string }[];
  } {
    if (!Array.isArray(connections)) throw new Error('Expected an array of connections');
    if (connections.length > MAX_IMPORT_CONNECTIONS) {
      throw new Error(
        `Import contains ${connections.length} connections (max ${MAX_IMPORT_CONNECTIONS})`,
      );
    }
    const insert = db.prepare(
      `INSERT INTO connections (
        id, name, provider, host, port, username, auth_type, private_key_path,
        endpoint, region, default_bucket, force_path_style,
        folder, color_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const findExistingSftp = db.prepare(
      'SELECT id FROM connections WHERE name = ? AND host = ? AND username = ?',
    );
    const findExistingByName = db.prepare('SELECT id FROM connections WHERE name = ?');
    let imported = 0;
    const skipped: { name: string; reason: string }[] = [];
    // Wrap the whole batch in a transaction so a malformed record at row N
    // doesn't leave 0..N-1 partially imported.
    const importAll = db.transaction((rows: ExportedConnection[]) => {
      for (const conn of rows) {
        const label = conn?.name ?? '(unnamed)';
        if (!conn?.name) {
          skipped.push({ name: label, reason: 'missing name' });
          continue;
        }
        try {
          assertImportFieldLen(conn.name, 'name');
          assertImportFieldLen(conn.host, 'host');
          assertImportFieldLen(conn.username, 'username');
          assertImportFieldLen(conn.endpoint, 'endpoint');
          assertImportFieldLen(conn.region, 'region');
          assertImportFieldLen(conn.defaultBucket, 'defaultBucket');
          assertImportFieldLen(conn.folder, 'folder');
          assertImportFieldLen(conn.colorTag, 'colorTag', 64);
          assertImportFieldLen(conn.privateKeyPath, 'privateKeyPath', 4096);
        } catch (err) {
          skipped.push({
            name: label,
            reason: err instanceof Error ? err.message : 'field too long',
          });
          continue;
        }
        const provider = conn.provider ?? 'sftp';
        const id = uuidv4();
        const now = Math.floor(Date.now() / 1000);

        if (provider === 'sftp') {
          if (!conn.host || !conn.username) {
            skipped.push({ name: label, reason: 'missing host/username' });
            continue;
          }
          if (findExistingSftp.get(conn.name, conn.host, conn.username)) {
            skipped.push({ name: label, reason: 'duplicate of existing connection' });
            continue;
          }
          const authType = conn.authType || 'password';
          if (!VALID_AUTH_TYPES.includes(authType as (typeof VALID_AUTH_TYPES)[number])) {
            skipped.push({ name: label, reason: `unsupported authType "${authType}"` });
            continue;
          }
          let safeKeyPath: string | null;
          try {
            safeKeyPath = sanitizeImportedKeyPath(conn.privateKeyPath);
          } catch (err) {
            skipped.push({
              name: label,
              reason: err instanceof Error ? err.message : 'invalid privateKeyPath',
            });
            continue;
          }
          insert.run(
            id,
            conn.name,
            'sftp',
            conn.host,
            conn.port || 22,
            conn.username,
            authType,
            safeKeyPath,
            null,
            null,
            null,
            null,
            conn.folder || 'default',
            conn.colorTag || null,
            now,
            now,
          );
          imported++;
        } else if (provider === 's3') {
          if (findExistingByName.get(conn.name)) {
            skipped.push({ name: label, reason: 'duplicate of existing connection' });
            continue;
          }
          insert.run(
            id,
            conn.name,
            's3',
            null,
            null,
            null,
            null,
            null,
            conn.endpoint || null,
            conn.region || null,
            conn.defaultBucket || null,
            conn.forcePathStyle ? 1 : 0,
            conn.folder || 'default',
            conn.colorTag || null,
            now,
            now,
          );
          imported++;
        } else {
          skipped.push({ name: label, reason: `unsupported provider "${provider}"` });
        }
      }
    });
    importAll(connections);
    return { imported, skipped };
  }

  ipcMain.handle(IPC.CONNECTION_IMPORT, (_event, connections: ExportedConnection[]) =>
    importConnections(connections),
  );

  ipcMain.handle(IPC.CONNECTION_IMPORT_FROM_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: -1, skipped: [] as { name: string; reason: string }[] };
    }

    const path = result.filePaths[0];
    const { stat } = await import('fs/promises');
    const stats = await stat(path);
    const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB — large enough for thousands of records
    if (stats.size > MAX_IMPORT_BYTES) {
      throw new Error(`Import file is too large: ${stats.size} bytes (max ${MAX_IMPORT_BYTES})`);
    }
    const content = await readFile(path, 'utf-8');
    let parsed: ExportedConnection[];
    try {
      parsed = JSON.parse(content) as ExportedConnection[];
    } catch {
      // Don't surface raw file content (which may include arbitrary bytes) to the renderer.
      throw new Error('Import file is not valid JSON');
    }
    return importConnections(parsed);
  });

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw new Error(`Unknown setting key: ${key}`);
    }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw new Error(`Unknown setting key: ${key}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Setting ${key} must be JSON-encoded`);
    }
    if (!checkSettingType(key, parsed)) {
      throw new Error(`Setting ${key} has wrong type`);
    }
    let v = value;
    if (key === 'terminal.scrollback') {
      const n = Math.max(1000, Math.min(LIMITS.MAX_SCROLLBACK, (parsed as number) || 10000));
      v = JSON.stringify(n);
    } else if (key === 'transfer.concurrency') {
      const n = Math.max(1, Math.min(LIMITS.MAX_CONCURRENT_TRANSFERS, (parsed as number) || 3));
      v = JSON.stringify(n);
      transferQueue.setMaxConcurrent(n);
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, v);
  });

  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      // Skip stored rows that don't match the expected schema — a stale row
      // from a previous install must not break the renderer.
      try {
        const parsed = JSON.parse(row.value);
        if (checkSettingType(row.key, parsed)) {
          settings[row.key] = parsed;
        }
      } catch {
        // Drop unparseable rows silently.
      }
    }
    return settings;
  });
}
