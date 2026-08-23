import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, LunaError } from '@shared/errors';
import type {
  AuthType,
  Connection,
  CreateConnectionInput,
  ExportedConnection,
  PortForwardingConfig,
  UpdateConnectionInput,
} from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import type Database from 'better-sqlite3';
import { dialog } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import log from '../lib/logger';
import {
  assertBoundedInt,
  assertNonEmptyString,
  expandAndConfineToHomeSync,
  validationError,
} from '../lib/validate';
import { deleteCredential, retrieveS3Credential, storeCredential } from './credential-store';
import { CONNECTION_COLUMNS, type ConnectionRow, getDatabase } from './database';
import { detectAndImport } from './importers';
import { parseSshConfig } from './importers/ssh-config';
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
/** Generous cap on a filesystem path — well past PATH_MAX on every platform. */
const MAX_PATH_LEN = 4096;

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
 * Range-check an optional numeric field, substituting `fallback` when it is
 * absent. Keepalive values reached the DB unchecked on both the create and the
 * import path — a negative or absurd interval is handed straight to ssh2's
 * timer setup.
 */
function assertOptionalBoundedNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw validationError(`${name} must be a number`);
  }
  if (value < min || value > max) {
    throw validationError(`${name} must be between ${min} and ${max}`);
  }
  return value;
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

/**
 * A connection's persistable fields after validation and defaulting — the
 * exact shape `insertConnectionRow` writes.
 */
interface NormalisedConnectionFields {
  provider: StorageProviderKind;
  name: string;
  host: string | null;
  port: number | null;
  username: string | null;
  authType: AuthType | null;
  privateKeyPath: string | null;
  endpoint: string | null;
  region: string | null;
  defaultBucket: string | null;
  forcePathStyle: number | null;
  folder: string;
  colorTag: string | null;
  isHidden: number;
  keepaliveInterval: number;
  keepaliveCountMax: number;
  portForwards: PortForwardingConfig[];
}

interface NormaliseOptions {
  /**
   * Used when the input omits `port`. Import files legitimately leave it out
   * (the SSH default is implied); the create form never does, so create
   * passes nothing and an absent port is a validation error.
   */
  portDefault?: number;
  /** Same idea for `authType`. */
  authTypeDefault?: AuthType;
  /**
   * Canonicalise `privateKeyPath` against the home directory. Import does
   * this because the path came from another machine's config file; the create
   * form's path was picked with a native file dialog on this machine.
   */
  expandKeyPath?: boolean;
}

/**
 * Validate and normalise the fields shared by every write path.
 *
 * `createConnection` and `importConnections` used to each open-code their own
 * subset of these rules, and import's subset was empty: it wrote `name`,
 * `folder`, `port`, `authType` and `port_forwards` straight to SQL with no
 * length caps, no null-byte checks, no range check and no allowlist. So a
 * value `create` rejected could still be written by importing a crafted
 * `.json` / `.ini` / `.mxtsessions` file — or by a renderer calling
 * `connection:import` directly — and then be read back everywhere as if it
 * had been validated. Both paths now route through this function, which is
 * the only way to keep them from drifting again.
 *
 * Throws `LunaError(VALIDATION_ERROR)`. Import catches and records the reason
 * per entry; create lets it propagate to the renderer.
 */
function normaliseConnectionFields(
  input: CreateConnectionInput | ExportedConnection,
  options: NormaliseOptions = {},
): NormalisedConnectionFields {
  const name = typeof input.name === 'string' ? input.name.trim() : input.name;
  assertNonEmptyString(name, 'name');
  assertBoundedLength(name, 'name', MAX_NAME_LEN);

  const provider = input.provider ?? 'sftp';
  if (provider !== 'sftp' && provider !== 's3') {
    throw validationError('provider must be "sftp" or "s3"');
  }

  const folder = input.folder?.trim() || 'default';
  assertNoNullBytes(folder, 'folder');
  assertBoundedLength(folder, 'folder', MAX_FOLDER_LEN);

  let colorTag: string | null = null;
  if (input.colorTag != null && input.colorTag !== '') {
    assertNoNullBytes(input.colorTag, 'colorTag');
    assertBoundedLength(input.colorTag, 'colorTag', MAX_COLOR_TAG_LEN);
    colorTag = input.colorTag;
  }

  const keepaliveInterval = assertOptionalBoundedNumber(
    input.keepaliveInterval,
    'keepaliveInterval',
    0,
    600_000,
    0,
  );
  const keepaliveCountMax = assertOptionalBoundedNumber(
    input.keepaliveCountMax,
    'keepaliveCountMax',
    0,
    100,
    3,
  );

  // Public binds are permitted at *save* time regardless of the setting; the
  // gate is enforced when a forward is actually started, so a saved config
  // survives the toggle being off.
  const portForwards = normalisePortForwardsInput(input.portForwards);

  const base = {
    provider,
    name,
    folder,
    colorTag,
    isHidden: input.isHidden ? 1 : 0,
    keepaliveInterval,
    keepaliveCountMax,
    portForwards,
  };

  if (provider === 'sftp') {
    const host = typeof input.host === 'string' ? input.host.trim() : input.host;
    assertNonEmptyString(host, 'host');
    assertBoundedLength(host, 'host', MAX_HOST_LEN);

    const username = typeof input.username === 'string' ? input.username.trim() : input.username;
    assertNonEmptyString(username, 'username');
    assertBoundedLength(username, 'username', MAX_USERNAME_LEN);

    const port = input.port ?? options.portDefault;
    assertBoundedInt(port, 'port', 1, 65535);

    const authType = input.authType ?? options.authTypeDefault;
    if (!authType || !VALID_AUTH_TYPES.includes(authType)) {
      throw validationError(`authType must be one of ${VALID_AUTH_TYPES.join('|')}`);
    }

    let privateKeyPath: string | null = null;
    if (input.privateKeyPath != null && input.privateKeyPath !== '') {
      assertNoNullBytes(input.privateKeyPath, 'privateKeyPath');
      assertBoundedLength(input.privateKeyPath, 'privateKeyPath', MAX_PATH_LEN);
      privateKeyPath = input.privateKeyPath;
      if (options.expandKeyPath) {
        try {
          privateKeyPath = expandAndConfineToHomeSync(input.privateKeyPath, 'privateKeyPath');
        } catch {
          // A key living outside the home subtree is legitimate (/etc/ssh,
          // a mounted secrets volume), so keep the literal path — the SSH
          // layer validates it again at connect time.
          privateKeyPath = input.privateKeyPath;
        }
      }
    }

    return {
      ...base,
      host,
      port,
      username,
      authType,
      privateKeyPath,
      endpoint: null,
      region: null,
      defaultBucket: null,
      forcePathStyle: null,
    };
  }

  const s3Text: Record<'endpoint' | 'region' | 'defaultBucket', string | null> = {
    endpoint: null,
    region: null,
    defaultBucket: null,
  };
  for (const field of ['endpoint', 'region', 'defaultBucket'] as const) {
    const value = input[field];
    if (value != null && value !== '') {
      assertNoNullBytes(value, field);
      assertBoundedLength(value, field, MAX_HOST_LEN);
      s3Text[field] = value;
    }
  }

  return {
    ...base,
    host: null,
    port: null,
    username: null,
    authType: null,
    privateKeyPath: null,
    ...s3Text,
    forcePathStyle: input.forcePathStyle ? 1 : 0,
  };
}

/**
 * The one `INSERT INTO connections` in the codebase. Create and import used
 * byte-identical 20-column statements; keeping two meant a new column could be
 * added to one and silently missed by the other.
 */
function insertConnectionRow(
  db: Database.Database,
  id: string,
  fields: NormalisedConnectionFields,
  now: number,
): void {
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
    fields.name,
    fields.provider,
    fields.host,
    fields.port,
    fields.username,
    fields.authType,
    fields.privateKeyPath,
    fields.endpoint,
    fields.region,
    fields.defaultBucket,
    fields.forcePathStyle,
    fields.folder,
    fields.colorTag,
    fields.isHidden,
    fields.keepaliveInterval,
    fields.keepaliveCountMax,
    JSON.stringify(fields.portForwards),
    now,
    now,
  );
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
    // Shared with the import path — see normaliseConnectionFields. Create,
    // update and import all enforce the same rules now; they used to enforce
    // three different subsets, so a value one path rejected could be written
    // by another and read back everywhere as if it had been checked.
    const fields = normaliseConnectionFields(input);
    const provider = fields.provider;

    // Credentials are the one thing import can't supply (they're stripped on
    // export), so this check stays on the create path.
    if (provider === 's3') {
      assertNonEmptyString(input.accessKeyId, 'accessKeyId');
      assertNonEmptyString(input.secretAccessKey, 'secretAccessKey');
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const createTx = db.transaction(() => {
      insertConnectionRow(db, id, fields, now);

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
          // Same caps the create path applies. Update checked null bytes but
          // not length, so an unbounded blob could still reach these columns.
          assertBoundedLength(
            raw,
            key,
            key === 'privateKeyPath'
              ? MAX_PATH_LEN
              : key === 'colorTag'
                ? MAX_COLOR_TAG_LEN
                : MAX_HOST_LEN,
          );
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
        value = assertOptionalBoundedNumber(raw, 'keepaliveInterval', 0, 600_000, 0);
      } else if (key === 'keepaliveCountMax') {
        value = assertOptionalBoundedNumber(raw, 'keepaliveCountMax', 0, 100, 3);
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
    // The `folder` column is capped and null-byte-checked on create and
    // update; rename wrote to the same column with neither check, so it was
    // the way to get an oversized folder header into the sidebar.
    assertNoNullBytes(params.oldName, 'oldName');
    assertNoNullBytes(params.newName, 'newName');
    assertBoundedLength(params.newName, 'newName', MAX_FOLDER_LEN);
    if (params.provider !== 'sftp' && params.provider !== 's3') {
      throw validationError('provider must be "sftp" or "s3"');
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

        // Import entries come from another machine's config file — a WinSCP
        // .ini, a PuTTY registry dump, ~/.ssh/config — or straight from the
        // renderer via `connection:import`. None of that is trustworthy, and
        // this loop used to write it to SQL with no checks whatsoever.
        //
        // A throw becomes a skip rather than aborting the whole import: one
        // malformed entry in a 200-connection file shouldn't cost the user the
        // other 199, and they get told exactly which one and why.
        let fields: NormalisedConnectionFields;
        try {
          fields = normaliseConnectionFields(
            { ...item, isHidden: false },
            { portDefault: 22, authTypeDefault: 'password', expandKeyPath: true },
          );
        } catch (err) {
          skipped.push({
            name,
            reason: err instanceof Error ? err.message : 'Invalid connection data',
          });
          continue;
        }

        insertConnectionRow(db, uuidv4(), fields, Math.floor(Date.now() / 1000));

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

    // Non-null: length check above guarantees index 0 exists.
    const filePath = result.filePaths[0]!;
    const fileContent = await readFile(filePath, 'utf-8');
    const connections = detectAndImport(fileContent, filePath);
    return this.importConnections(connections);
  }

  async importFromSshConfig(): Promise<{
    imported: number;
    skipped: { name: string; reason: string }[];
  }> {
    // `os.homedir()`, not `$HOME`: the env var can be unset or empty (launchd,
    // a stripped systemd unit), in which case the old string concatenation
    // resolved to `/.ssh/config`. It also hardcoded `/`, which is wrong on
    // Windows. This is the same rule `lib/validate.ts` documents for every
    // other home-relative path in the app.
    const sshConfigPath = join(homedir(), '.ssh', 'config');
    let fileContent: string;
    try {
      fileContent = await readFile(sshConfigPath, 'utf-8');
    } catch {
      throw new LunaError(
        `Could not read ~/.ssh/config file at ${sshConfigPath}`,
        ErrorCode.NOT_FOUND,
      );
    }
    const connections = parseSshConfig(fileContent);
    return this.importConnections(connections);
  }
}

export const connectionService = new ConnectionService();
