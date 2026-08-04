import { readFile } from 'node:fs/promises';
import { ErrorCode, LunaError } from '@shared/errors';
import type {
  AuthType,
  Connection,
  CreateConnectionInput,
  ExportedConnection,
  PortForwardingConfig,
  UpdateConnectionInput,
} from '@shared/types/connection';
import { dialog } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { detectAndImport } from '../lib/importers';
import log from '../lib/logger';
import {
  assertBoundedInt,
  assertNonEmptyString,
  expandAndConfineToHomeSync,
  validationError,
} from '../lib/validate';
import { deleteCredential, retrieveS3Credential, storeCredential } from './credential-store';
import { CONNECTION_COLUMNS, type ConnectionRow, getDatabase } from './database';
import { validatePortForwardConfig } from './ssh/port-forward-config';

const VALID_AUTH_TYPES = ['password', 'key', 'key+passphrase'] as const;

/**
 * Length caps on free-text columns. Without them a pasted multi-line blob
 * becomes a connection name or a sidebar folder header, wrecking the layout
 * with no way to tell what happened.
 */
const MAX_NAME_LEN = 200;
const MAX_FOLDER_LEN = 100;
const MAX_HOST_LEN = 255;
const MAX_USERNAME_LEN = 255;
const MAX_COLOR_TAG_LEN = 64;

function assertNoNullBytes(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw validationError(`${name} must be a string`);
  if (value.includes('\0')) throw validationError(`${name} must not contain null bytes`);
}

function assertBoundedLength(value: string, name: string, max: number): void {
  if (value.length > max) {
    throw validationError(`${name} must be at most ${max} characters`);
  }
}

/**
 * Validate a `portForwards` array from the renderer. Public binds are allowed
 * at *save* time regardless of the setting — the setting is enforced when the
 * forward is actually started, so a user can keep a saved config while the
 * toggle is off without losing it on every edit.
 */
function normalisePortForwardsInput(raw: unknown): PortForwardingConfig[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw validationError('portForwards must be an array');
  return raw.map((entry) => validatePortForwardConfig(entry, { allowPublicBind: true }));
}

/**
 * Decode the `port_forwards` JSON column defensively.
 *
 * A bare `JSON.parse` here meant one malformed row — from a partial write, a
 * hand-edited sqlite file, or a future schema change — threw out of
 * `listConnections()` and blanked the entire sidebar, with no way for the user
 * to reach the connection and fix it. Degrade to "this connection has no
 * forwards" instead.
 */
function parsePortForwardsColumn(raw: string | null, connectionId: string): PortForwardingConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn(`[Connections] Ignoring malformed port_forwards JSON on connection ${connectionId}`);
    return [];
  }
}

export function rowToConnection(row: ConnectionRow): Connection {
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
    sortOrder: row.sort_order,
    lastConnectedAt: row.last_connected_at || undefined,
    isHidden: row.is_hidden === 1,
    keepaliveInterval: row.keepalive_interval || undefined,
    keepaliveCountMax: row.keepalive_count_max || undefined,
    portForwards: parsePortForwardsColumn(row.port_forwards, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
  isHidden: 'is_hidden',
  keepaliveInterval: 'keepalive_interval',
  keepaliveCountMax: 'keepalive_count_max',
  portForwards: 'port_forwards',
};

export class ConnectionService {
  listConnections(): Connection[] {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections ORDER BY sort_order ASC, name ASC`)
      .all() as ConnectionRow[];
    return rows.map(rowToConnection);
  }

  getConnection(id: string): Connection | null {
    const db = getDatabase();
    const row = db.prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections WHERE id = ?`).get(id) as
      | ConnectionRow
      | undefined;
    return row ? rowToConnection(row) : null;
  }

  createConnection(input: CreateConnectionInput): Connection {
    const db = getDatabase();
    // Create used to validate far less than update: no null-byte checks, no
    // length caps, no authType allowlist, no port-forward shape check. That
    // asymmetry meant a value the update path rejected could still be written
    // by create and then read back everywhere. Both paths now enforce the
    // same rules.
    assertNonEmptyString(input.name, 'name');
    assertBoundedLength(input.name, 'name', MAX_NAME_LEN);
    const provider = input.provider ?? 'sftp';
    if (provider !== 'sftp' && provider !== 's3') {
      throw validationError('provider must be "sftp" or "s3"');
    }

    const folder = input.folder?.trim() || 'default';
    assertNoNullBytes(folder, 'folder');
    assertBoundedLength(folder, 'folder', MAX_FOLDER_LEN);
    if (input.colorTag != null) {
      assertNoNullBytes(input.colorTag, 'colorTag');
      assertBoundedLength(input.colorTag, 'colorTag', MAX_COLOR_TAG_LEN);
    }

    if (provider === 'sftp') {
      assertNonEmptyString(input.host, 'host');
      assertBoundedLength(input.host, 'host', MAX_HOST_LEN);
      assertNonEmptyString(input.username, 'username');
      assertBoundedLength(input.username, 'username', MAX_USERNAME_LEN);
      assertBoundedInt(input.port, 'port', 1, 65535);
      if (!input.authType || !VALID_AUTH_TYPES.includes(input.authType)) {
        throw validationError(`authType must be one of ${VALID_AUTH_TYPES.join('|')}`);
      }
      if (input.privateKeyPath != null && input.privateKeyPath !== '') {
        assertNoNullBytes(input.privateKeyPath, 'privateKeyPath');
      }
    } else {
      assertNonEmptyString(input.accessKeyId, 'accessKeyId');
      assertNonEmptyString(input.secretAccessKey, 'secretAccessKey');
      for (const field of ['endpoint', 'region', 'defaultBucket'] as const) {
        const value = input[field];
        if (value != null && value !== '') {
          assertNoNullBytes(value, field);
          assertBoundedLength(value, field, MAX_HOST_LEN);
        }
      }
    }

    // Validated up front so a bad forward is rejected at save time rather than
    // silently dropped when the session later tries to start it.
    const portForwards = normalisePortForwardsInput(input.portForwards);

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const createTx = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO connections (
          id, name, provider, host, port, username, auth_type, private_key_path,
          endpoint, region, default_bucket, force_path_style,
          folder, color_tag,
          is_hidden,
          keepalive_interval, keepalive_count_max, port_forwards,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        folder,
        input.colorTag || null,
        input.isHidden ? 1 : 0,
        input.keepaliveInterval ?? 0,
        input.keepaliveCountMax ?? 3,
        JSON.stringify(portForwards),
        now,
        now,
      );

      // Store credentials.
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
    });

    createTx();

    const row = db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections WHERE id = ?`)
      .get(id) as ConnectionRow;
    const connection = rowToConnection(row);
    log.info(`Connection created: ${connection.name}`, {
      id: connection.id,
      provider: connection.provider,
    });
    return connection;
  }

  updateConnection(input: UpdateConnectionInput): Connection {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const existing = db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections WHERE id = ?`)
      .get(input.id) as ConnectionRow | undefined;

    if (!existing) {
      throw new LunaError(`Connection not found: ${input.id}`, ErrorCode.NOT_FOUND);
    }

    const assignments: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    const VALID_PROVIDERS = new Set(['sftp', 's3']);
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
        if (raw === null || raw === '') {
          value = null;
        } else if (typeof raw !== 'string') {
          throw validationError(`${key} must be a string`);
        } else {
          if (raw.includes('\0')) throw validationError(`${key} must not contain null bytes`);
          value = raw;
        }
      } else if (key === 'folder') {
        if (raw === null || raw === '') {
          value = 'default';
        } else if (typeof raw !== 'string') {
          throw validationError('folder must be a string');
        } else {
          assertNoNullBytes(raw, 'folder');
          assertBoundedLength(raw, 'folder', MAX_FOLDER_LEN);
          value = raw;
        }
      } else if (key === 'forcePathStyle' || key === 'isHidden') {
        if (typeof raw !== 'boolean' && raw !== 0 && raw !== 1 && raw !== null) {
          throw validationError(`${key} must be a boolean`);
        }
        value = raw ? 1 : 0;
      } else if (key === 'keepaliveInterval') {
        if (raw === null || raw === '') {
          value = 0;
        } else if (typeof raw !== 'number') {
          throw validationError('keepaliveInterval must be a number');
        } else {
          value = raw;
        }
      } else if (key === 'keepaliveCountMax') {
        if (raw === null || raw === '') {
          value = 3;
        } else if (typeof raw !== 'number') {
          throw validationError('keepaliveCountMax must be a number');
        } else {
          value = raw;
        }
      } else if (key === 'portForwards') {
        value = JSON.stringify(normalisePortForwardsInput(raw));
      } else if (key === 'port') {
        assertBoundedInt(raw, 'port', 1, 65535);
        value = raw;
      } else if (key === 'name' || key === 'host' || key === 'username') {
        assertNonEmptyString(raw, key);
        assertBoundedLength(
          raw,
          key,
          key === 'name' ? MAX_NAME_LEN : key === 'host' ? MAX_HOST_LEN : MAX_USERNAME_LEN,
        );
        value = raw;
      } else if (key === 'authType') {
        if (typeof raw !== 'string' || !VALID_AUTH_TYPES.includes(raw as AuthType)) {
          throw validationError(`authType must be one of ${VALID_AUTH_TYPES.join('|')}`);
        }
        value = raw;
      } else if (key === 'provider') {
        if (typeof raw !== 'string' || !VALID_PROVIDERS.has(raw)) {
          throw validationError('provider must be "sftp" or "s3"');
        }
        value = raw;
      } else {
        throw validationError(`Unhandled update field: ${key}`);
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }

    values.push(input.id);

    const updateTx = db.transaction(() => {
      db.prepare(`UPDATE connections SET ${assignments.join(', ')} WHERE id = ?`).run(...values);

      const provider = input.provider ?? existing.provider ?? 'sftp';
      const providerChanged = input.provider != null && input.provider !== existing.provider;
      const authTypeChanged =
        provider === 'sftp' && input.authType != null && input.authType !== existing.auth_type;
      if (providerChanged || authTypeChanged) {
        deleteCredential(input.id);
      }
      if (provider === 'sftp') {
        if (input.password) {
          storeCredential(input.id, input.password);
        } else if (input.passphrase) {
          storeCredential(input.id, input.passphrase);
        }
      } else if (provider === 's3' && (input.accessKeyId || input.secretAccessKey)) {
        const prev = retrieveS3Credential(input.id);
        storeCredential(
          input.id,
          JSON.stringify({
            accessKeyId: input.accessKeyId ?? prev?.accessKeyId,
            secretAccessKey: input.secretAccessKey ?? prev?.secretAccessKey,
            sessionToken: input.sessionToken ?? prev?.sessionToken,
          }),
        );
      }
    });

    updateTx();

    const row = db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections WHERE id = ?`)
      .get(input.id) as ConnectionRow;
    const connection = rowToConnection(row);
    log.info(`Connection updated: ${connection.name}`, { id: connection.id });
    return connection;
  }

  renameFolder(params: { oldName: string; newName: string; provider: 'sftp' | 's3' }): void {
    const db = getDatabase();
    if (!params.oldName || !params.newName) {
      throw validationError('oldName and newName are required');
    }
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      'UPDATE connections SET folder = ?, updated_at = ? WHERE folder = ? AND provider = ?',
    ).run(params.newName, now, params.oldName, params.provider);
  }

  deleteConnection(id: string): void {
    const db = getDatabase();
    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM connection_history WHERE connection_id = ?').run(id);
      db.prepare('DELETE FROM connections WHERE id = ?').run(id);
      deleteCredential(id);
    });

    deleteTx();
    log.info(`Connection deleted: ${id}`);
  }

  deleteAllConnections(): void {
    const db = getDatabase();
    const rows = db.prepare('SELECT id FROM connections').all() as { id: string }[];
    const deleteAllTx = db.transaction(() => {
      db.prepare('DELETE FROM connection_history').run();
      db.prepare('DELETE FROM connections').run();
      for (const row of rows) {
        deleteCredential(row.id);
      }
    });

    deleteAllTx();
    log.info(`All connections deleted (${rows.length} connections removed)`);
  }

  reorderConnections(ids: string[]): void {
    const db = getDatabase();
    if (!Array.isArray(ids)) {
      throw validationError('ids must be an array');
    }
    const stmt = db.prepare('UPDATE connections SET sort_order = ? WHERE id = ?');
    const transaction = db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i]);
      }
    });
    transaction();
  }

  exportConnections(): ExportedConnection[] {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT ${CONNECTION_COLUMNS} FROM connections ORDER BY sort_order ASC, name ASC`)
      .all() as ConnectionRow[];

    return rows.map((row) => {
      const conn = rowToConnection(row);
      const out: ExportedConnection = {
        name: conn.name,
        provider: conn.provider,
        folder: conn.folder,
        colorTag: conn.colorTag,
        sortOrder: conn.sortOrder,
      };

      if (conn.provider === 'sftp') {
        out.host = conn.host;
        out.port = conn.port;
        out.username = conn.username;
        out.authType = conn.authType;
        out.privateKeyPath = conn.privateKeyPath;
        out.keepaliveInterval = conn.keepaliveInterval;
        out.keepaliveCountMax = conn.keepaliveCountMax;
        out.portForwards = conn.portForwards;
      } else if (conn.provider === 's3') {
        out.endpoint = conn.endpoint;
        out.region = conn.region;
        out.defaultBucket = conn.defaultBucket;
        out.forcePathStyle = conn.forcePathStyle;
      }

      return out;
    });
  }

  importConnections(connections: ExportedConnection[]): {
    imported: number;
    skipped: { name: string; reason: string }[];
  } {
    if (!Array.isArray(connections)) {
      throw validationError('connections must be an array');
    }

    const db = getDatabase();
    const existingNames = new Set(
      (db.prepare('SELECT name FROM connections').all() as { name: string }[]).map((r) => r.name),
    );

    let imported = 0;
    const skipped: { name: string; reason: string }[] = [];

    const importTx = db.transaction(() => {
      for (const item of connections) {
        if (!item || typeof item !== 'object') {
          skipped.push({ name: 'Unknown', reason: 'Invalid entry format' });
          continue;
        }

        const name = (item.name || '').trim();
        if (!name) {
          skipped.push({ name: 'Unnamed', reason: 'Missing connection name' });
          continue;
        }

        if (existingNames.has(name)) {
          skipped.push({ name, reason: 'A connection with this name already exists' });
          continue;
        }

        const provider = item.provider === 's3' ? 's3' : 'sftp';

        if (provider === 'sftp') {
          if (!item.host?.trim() || !item.username?.trim()) {
            skipped.push({ name, reason: 'SFTP connections require host and username' });
            continue;
          }
        }

        let keyPath: string | null = null;
        if (provider === 'sftp' && item.privateKeyPath) {
          if (item.privateKeyPath.includes('\0')) {
            skipped.push({ name, reason: 'privateKeyPath must not contain null bytes' });
            continue;
          }
          try {
            keyPath = expandAndConfineToHomeSync(item.privateKeyPath, 'privateKeyPath');
          } catch {
            keyPath = item.privateKeyPath;
          }
        }

        const id = uuidv4();
        const now = Math.floor(Date.now() / 1000);

        db.prepare(
          `
          INSERT INTO connections (
            id, name, provider, host, port, username, auth_type, private_key_path,
            endpoint, region, default_bucket, force_path_style,
            folder, color_tag,
            is_hidden, keepalive_interval, keepalive_count_max, port_forwards,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          id,
          name,
          provider,
          provider === 'sftp' ? (item.host?.trim() ?? null) : null,
          provider === 'sftp' ? (item.port ?? 22) : null,
          provider === 'sftp' ? (item.username?.trim() ?? null) : null,
          provider === 'sftp' ? (item.authType ?? 'password') : null,
          provider === 'sftp' ? keyPath : null,
          provider === 's3' ? item.endpoint || null : null,
          provider === 's3' ? item.region || null : null,
          provider === 's3' ? item.defaultBucket || null : null,
          provider === 's3' ? (item.forcePathStyle ? 1 : 0) : null,
          item.folder || 'default',
          item.colorTag || null,
          0,
          item.keepaliveInterval ?? 0,
          item.keepaliveCountMax ?? 3,
          item.portForwards ? JSON.stringify(item.portForwards) : '[]',
          now,
          now,
        );

        existingNames.add(name);
        imported++;
      }
    });

    importTx();
    log.info(`Import complete: ${imported} imported, ${skipped.length} skipped`);
    return { imported, skipped };
  }

  async importFromFile(): Promise<{
    imported: number;
    skipped: { name: string; reason: string }[];
  }> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Luna / WinSCP / MobaXterm Connections',
          extensions: ['json', 'ini', 'mxtsessions'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: 0, skipped: [] };
    }

    const filePath = result.filePaths[0];
    const fileContent = await readFile(filePath, 'utf-8');
    const connections = detectAndImport(filePath, fileContent);
    return this.importConnections(connections);
  }

  async importFromSshConfig(): Promise<{
    imported: number;
    skipped: { name: string; reason: string }[];
  }> {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const sshConfigPath = `${home}/.ssh/config`;
    let fileContent: string;
    try {
      fileContent = await readFile(sshConfigPath, 'utf-8');
    } catch {
      throw new LunaError(
        `Could not read ~/.ssh/config file at ${sshConfigPath}`,
        ErrorCode.NOT_FOUND,
      );
    }
    const connections = detectAndImport(sshConfigPath, fileContent);
    return this.importConnections(connections);
  }
}

export const connectionService = new ConnectionService();
