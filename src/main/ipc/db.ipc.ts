import { dialog, ipcMain } from 'electron';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
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
 * of the app doesn't expect (S7). */
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
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    privateKeyPath: row.private_key_path || undefined,
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
    // Validate required fields
    if (!input.name?.trim()) throw new Error('Connection name is required');
    if (!input.host?.trim()) throw new Error('Host is required');
    if (!input.username?.trim()) throw new Error('Username is required');
    if (typeof input.port !== 'number' || input.port < 1 || input.port > 65535) {
      throw new Error('Port must be between 1 and 65535');
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `
      INSERT INTO connections (id, name, host, port, username, auth_type, private_key_path, folder, color_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.name,
      input.host,
      input.port,
      input.username,
      input.authType,
      input.privateKeyPath || null,
      input.folder || 'default',
      input.colorTag || null,
      now,
      now,
    );

    // Store password/passphrase if provided
    if (input.password) {
      storeCredential(id, input.password);
    } else if (input.passphrase) {
      storeCredential(id, input.passphrase);
    }

    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow;
    return rowToConnection(row);
  });

  // Whitelist of UpdateConnectionInput keys → DB column names. Only fields listed
  // here may be passed to the dynamic UPDATE; an explicit allow-list is safer than
  // trusting future contributors to keep the if-chain in sync with the SQL.
  const UPDATE_FIELD_MAP: Record<string, string> = {
    name: 'name',
    host: 'host',
    port: 'port',
    username: 'username',
    authType: 'auth_type',
    privateKeyPath: 'private_key_path',
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
      if (key === 'privateKeyPath' || key === 'colorTag') {
        value = (raw as string) || null;
      } else {
        value = raw as string | number;
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    values.push(input.id);

    db.prepare(`UPDATE connections SET ${assignments.join(', ')} WHERE id = ?`).run(...values);

    // Update credential if provided
    if (input.password) {
      storeCredential(input.id, input.password);
    } else if (input.passphrase) {
      storeCredential(input.id, input.passphrase);
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
    return rows.map((row) => ({
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      ...(row.private_key_path ? { privateKeyPath: row.private_key_path } : {}),
      ...(row.folder && row.folder !== 'default' ? { folder: row.folder } : {}),
      ...(row.color_tag ? { colorTag: row.color_tag } : {}),
    }));
  });

  function importConnections(connections: ExportedConnection[]): {
    imported: number;
    skipped: { name: string; reason: string }[];
  } {
    if (!Array.isArray(connections)) throw new Error('Expected an array of connections');
    const insert = db.prepare(
      `INSERT INTO connections (id, name, host, port, username, auth_type, private_key_path, folder, color_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const findExisting = db.prepare(
      'SELECT id FROM connections WHERE name = ? AND host = ? AND username = ?',
    );
    let imported = 0;
    const skipped: { name: string; reason: string }[] = [];
    // Wrap the whole batch in a transaction so a malformed record at row N
    // doesn't leave 0..N-1 partially imported.
    const importAll = db.transaction((rows: ExportedConnection[]) => {
      for (const conn of rows) {
        const label = conn?.name ?? '(unnamed)';
        if (!conn?.name || !conn?.host || !conn?.username) {
          skipped.push({ name: label, reason: 'missing name/host/username' });
          continue;
        }
        if (findExisting.get(conn.name, conn.host, conn.username)) {
          skipped.push({ name: label, reason: 'duplicate of existing connection' });
          continue;
        }
        const id = uuidv4();
        const now = Math.floor(Date.now() / 1000);
        const authType = conn.authType || 'password';
        if (!VALID_AUTH_TYPES.includes(authType as (typeof VALID_AUTH_TYPES)[number])) {
          skipped.push({ name: label, reason: `unsupported authType "${authType}"` });
          continue;
        }
        insert.run(
          id,
          conn.name,
          conn.host,
          conn.port || 22,
          conn.username,
          authType,
          conn.privateKeyPath || null,
          conn.folder || 'default',
          conn.colorTag || null,
          now,
          now,
        );
        imported++;
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
