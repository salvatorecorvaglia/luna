import { dialog } from 'electron';
import { readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { expandAndConfineToHomeSync } from '../lib/validate';
import { IPC, LIMITS } from '@shared/constants';
import { ErrorCode, LunarError } from '@shared/errors';

function validation(message: string): LunarError {
  return new LunarError(message, ErrorCode.VALIDATION_ERROR);
}
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
import { registerHandler } from '../lib/ipc-handler';

import { logger } from '../lib/logger';
import { detectAndImport } from '../lib/importers';

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

/**
 * Inclusive bounds for numeric settings. Anything outside this range will be
 * rejected during SETTING_SET. Without these, a renderer could write
 * `Number.MAX_SAFE_INTEGER` or `0` and put the consumer (e.g. transfer queue
 * concurrency) into a wedged state. `Number.isFinite` in `checkSettingType`
 * already strips NaN/Infinity, but doesn't bound the magnitude.
 */
const SETTING_NUMERIC_BOUNDS: Partial<Record<keyof AppSettings, { min: number; max: number }>> = {
  'terminal.fontSize': { min: 8, max: 72 },
  'terminal.scrollback': { min: 0, max: 1_000_000 },
  'transfer.concurrency': { min: 1, max: LIMITS.MAX_CONCURRENT_TRANSFERS },
  'ssh.keepAliveInterval': { min: 0, max: 600_000 },
  'ssh.maxReconnectAttempts': { min: 0, max: 100 },
  'ssh.readyTimeout': { min: 1_000, max: 600_000 },
};

function checkSettingType(key: string, parsed: unknown): boolean {
  const expected = SETTING_TYPES[key as keyof AppSettings];
  if (!expected) return false;
  if (expected === 'number') {
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return false;
    const bounds = SETTING_NUMERIC_BOUNDS[key as keyof AppSettings];
    if (bounds && (parsed < bounds.min || parsed > bounds.max)) return false;
    return true;
  }
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
    sortOrder: row.sort_order,
    jumpHostConnectionId: row.jump_host_connection_id || undefined,
    lastConnectedAt: row.last_connected_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validate that `jumpHostConnectionId` points to a usable bastion row.
 * Throws a VALIDATION_ERROR with a user-friendly message on any violation.
 * Rules:
 *  - The id must exist.
 *  - The target row must be an SFTP connection (S3 has no notion of SSH).
 *  - It must not equal `selfId` (would create a 1-node cycle).
 *  - It must not itself have `jump_host_connection_id` set (single-hop only,
 *    until/unless multi-hop chains are added).
 */
function assertValidJumpHost(
  db: ReturnType<typeof getDatabase>,
  jumpId: string,
  selfId: string | null,
): void {
  if (selfId && jumpId === selfId) {
    throw validation('A connection cannot use itself as a jump host');
  }
  const row = db
    .prepare('SELECT id, provider, jump_host_connection_id FROM connections WHERE id = ?')
    .get(jumpId) as
    | { id: string; provider: string; jump_host_connection_id: string | null }
    | undefined;
  if (!row) throw validation('Jump host connection not found');
  if (row.provider !== 'sftp') {
    throw validation('Jump host must be an SSH/SFTP connection');
  }
  if (row.jump_host_connection_id) {
    throw validation(
      'Jump host already chains through another bastion; multi-hop is not supported',
    );
  }
}

export function registerDbHandlers(): void {
  const db = getDatabase();

  registerHandler(IPC.CONNECTION_LIST, () => {
    const rows = db
      .prepare('SELECT * FROM connections ORDER BY sort_order ASC, name ASC')
      .all() as ConnectionRow[];
    return rows.map(rowToConnection);
  });

  registerHandler(IPC.CONNECTION_GET, (_event, id: string) => {
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as
      | ConnectionRow
      | undefined;
    return row ? rowToConnection(row) : null;
  });

  registerHandler(IPC.CONNECTION_CREATE, (_event, input: CreateConnectionInput) => {
    if (!input.name?.trim()) throw validation('Connection name is required');
    const provider = input.provider ?? 'sftp';

    if (provider === 'sftp') {
      if (!input.host?.trim()) throw validation('Host is required');
      if (!input.username?.trim()) throw validation('Username is required');
      if (typeof input.port !== 'number' || input.port < 1 || input.port > 65535) {
        throw validation('Port must be between 1 and 65535');
      }
      if (!input.authType) throw validation('authType is required');
    } else if (provider === 's3') {
      if (!input.accessKeyId?.trim()) throw validation('Access Key ID is required');
      if (!input.secretAccessKey?.trim()) throw validation('Secret Access Key is required');
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const jumpHostId =
      provider === 'sftp' && input.jumpHostConnectionId ? input.jumpHostConnectionId : null;
    if (jumpHostId) assertValidJumpHost(db, jumpHostId, null);

    db.prepare(
      `
      INSERT INTO connections (
        id, name, provider, host, port, username, auth_type, private_key_path,
        endpoint, region, default_bucket, force_path_style,
        folder, color_tag, jump_host_connection_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      jumpHostId,
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
    const connection = rowToConnection(row);
    logger.info(`Connection created: ${connection.name}`, {
      id: connection.id,
      provider: connection.provider,
    });
    return connection;
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
    jumpHostConnectionId: 'jump_host_connection_id',
  };

  registerHandler(IPC.CONNECTION_UPDATE, (_event, input: UpdateConnectionInput) => {
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(input.id) as
      | ConnectionRow
      | undefined;

    if (!existing) {
      throw new LunarError(`Connection not found: ${input.id}`, ErrorCode.NOT_FOUND);
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
      } else if (key === 'jumpHostConnectionId') {
        // Explicit null clears the reference; non-empty string sets it.
        // Empty-string is treated as null so a cleared form field doesn't
        // try to assertValidJumpHost('') and produce a "not found" error.
        const v = raw === null || raw === '' ? null : (raw as string);
        if (v !== null) assertValidJumpHost(db, v, input.id);
        value = v;
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
    // If the provider changed (e.g. sftp → s3) or the SFTP authType changed
    // (e.g. password → key), the previously stored credential is no longer
    // valid for the connection and would otherwise persist until the row is
    // deleted; clear it before storing the new one.
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
    const connection = rowToConnection(row);
    logger.info(`Connection updated: ${connection.name}`, { id: connection.id });
    return connection;
  });

  registerHandler(IPC.CONNECTION_DELETE, (_event, id: string) => {
    // Delete the credential first inside a transaction so a failure on either
    // step rolls back the other — otherwise a thrown deleteCredential() would
    // leave an orphaned secret with no owning row.
    const deleteBoth = db.transaction((connId: string) => {
      deleteCredential(connId);
      db.prepare('DELETE FROM connections WHERE id = ?').run(connId);
    });
    deleteBoth(id);
    logger.info(`Connection deleted: ${id}`);
  });

  registerHandler(IPC.CONNECTION_DELETE_ALL, () => {
    const deleteAll = db.transaction(() => {
      // First get all IDs to clear credentials from the secure store
      const rows = db.prepare('SELECT id FROM connections').all() as { id: string }[];
      for (const row of rows) {
        deleteCredential(row.id);
      }
      db.prepare('DELETE FROM connections').run();
    });
    deleteAll();
    logger.info('All connections deleted');
  });

  registerHandler(IPC.CONNECTION_REORDER, (_event, ids: string[]) => {
    const update = db.prepare('UPDATE connections SET sort_order = ? WHERE id = ?');
    const transaction = db.transaction((idList: string[]) => {
      idList.forEach((id, index) => {
        update.run(index, id);
      });
    });
    transaction(ids);
  });

  registerHandler(IPC.CONNECTION_EXPORT, (): ExportedConnection[] => {
    const rows = db
      .prepare('SELECT * FROM connections ORDER BY sort_order ASC, name ASC')
      .all() as ConnectionRow[];
    // Build an id → name map up-front so the per-row export can resolve the
    // jump host name without an N+1 SELECT.
    const idToName = new Map(rows.map((r) => [r.id, r.name]));
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
      if (row.jump_host_connection_id) {
        const name = idToName.get(row.jump_host_connection_id);
        if (name) out.jumpHostName = name;
      }
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
      throw validation('privateKeyPath must be a string');
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
      throw validation(`${label} exceeds ${max} characters`);
    }
  }

  /**
   * Current on-disk export format version. Bumped when the schema changes in
   * a breaking way; importers reject unknown versions instead of silently
   * dropping fields they don't understand.
   */
  const LUNAR_EXPORT_FORMAT_VERSION = 1;

  /**
   * Normalize an imported payload into a `ExportedConnection[]`. Accepts:
   *   - bare array (legacy, pre-version-stamp exports)
   *   - `{ version, connections }` envelope (current)
   * Throws on unknown envelope versions so we don't silently mis-parse a
   * future format with renamed / re-typed fields.
   */
  function unwrapImportPayload(input: unknown): ExportedConnection[] {
    if (Array.isArray(input)) return input as ExportedConnection[];
    if (input && typeof input === 'object') {
      const env = input as { version?: unknown; connections?: unknown };
      if (env.version !== undefined) {
        if (env.version !== LUNAR_EXPORT_FORMAT_VERSION) {
          throw validation(
            `Unsupported export format version ${String(env.version)} (expected ${LUNAR_EXPORT_FORMAT_VERSION})`,
          );
        }
      }
      if (Array.isArray(env.connections)) return env.connections as ExportedConnection[];
    }
    throw validation('Expected an array of connections or { version, connections } envelope');
  }

  function importConnections(payload: ExportedConnection[] | unknown): {
    imported: number;
    skipped: { name: string; reason: string }[];
  } {
    const connections = unwrapImportPayload(payload);
    if (!Array.isArray(connections)) throw validation('Expected an array of connections');
    if (connections.length > MAX_IMPORT_CONNECTIONS) {
      throw validation(
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
    /**
     * Track imported SFTP rows by name → id so a second pass can wire up
     * `jumpHostConnectionId` by matching `jumpHostName` from the export.
     * We resolve in two passes (instead of one with `findExistingByName`)
     * because the bastion row may appear *after* a target in the import
     * file — single-pass would miss the link in that case.
     */
    const importedSftpByName = new Map<string, string>();
    /**
     * Queued jump-host links: targetId → bastion name. Resolved after the
     * insert pass, against both `importedSftpByName` and any preexisting
     * SFTP rows in the database with that name.
     */
    const pendingJumpHostLinks: { targetId: string; name: string; targetLabel: string }[] = [];
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
          importedSftpByName.set(conn.name, id);
          if (conn.jumpHostName) {
            pendingJumpHostLinks.push({
              targetId: id,
              name: conn.jumpHostName,
              targetLabel: label,
            });
          }
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

    // Second pass: resolve jumpHostName references. Run outside the import
    // transaction so a single bad link doesn't roll back all imported rows —
    // unmatched references just get reported in `skipped`.
    if (pendingJumpHostLinks.length > 0) {
      const findSftpByName = db.prepare(
        "SELECT id, jump_host_connection_id FROM connections WHERE name = ? AND provider = 'sftp' LIMIT 1",
      );
      const updateLink = db.prepare(
        'UPDATE connections SET jump_host_connection_id = ? WHERE id = ?',
      );
      const linkAll = db.transaction(() => {
        for (const link of pendingJumpHostLinks) {
          if (link.name === link.targetLabel) {
            skipped.push({
              name: link.targetLabel,
              reason: 'jump host references itself',
            });
            continue;
          }
          const inBatchId = importedSftpByName.get(link.name);
          const dbRow = findSftpByName.get(link.name) as
            | { id: string; jump_host_connection_id: string | null }
            | undefined;
          const bastionId = inBatchId ?? dbRow?.id;
          if (!bastionId) {
            skipped.push({
              name: link.targetLabel,
              reason: `jump host "${link.name}" not found (imported without bastion link)`,
            });
            continue;
          }
          // Re-check single-hop invariant against the resolved bastion row.
          const bastionRow = dbRow ??
            (db
              .prepare('SELECT jump_host_connection_id FROM connections WHERE id = ?')
              .get(bastionId) as { jump_host_connection_id: string | null } | undefined) ?? {
              jump_host_connection_id: null,
            };
          if (bastionRow.jump_host_connection_id) {
            skipped.push({
              name: link.targetLabel,
              reason: `jump host "${link.name}" itself chains through another bastion`,
            });
            continue;
          }
          updateLink.run(bastionId, link.targetId);
        }
      });
      linkAll();
    }

    return { imported, skipped };
  }

  registerHandler(IPC.CONNECTION_IMPORT, (_event, connections: ExportedConnection[]) =>
    importConnections(connections),
  );

  registerHandler(IPC.CONNECTION_IMPORT_FROM_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Connection Exports', extensions: ['json', 'ini', 'reg', 'mxtpro', 'mxtsessions'] },
        { name: 'MobaXterm Sessions', extensions: ['mxtsessions'] },
        { name: 'INI/Configuration', extensions: ['ini', 'mxtpro', 'mxtsessions'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'Registry', extensions: ['reg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: -1, skipped: [] as { name: string; reason: string }[] };
    }

    const path = result.filePaths[0];
    const { stat } = await import('fs/promises');
    const stats = await stat(path);
    const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB — large enough for thousands of records
    if (stats.size > MAX_IMPORT_BYTES) {
      throw validation(`Import file is too large: ${stats.size} bytes (max ${MAX_IMPORT_BYTES})`);
    }
    const content = await readFile(path, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
      return importConnections(parsed);
    } catch {
      // Not JSON, try third-party importers (INI/REG)
      const thirdParty = detectAndImport(content, path);
      if (thirdParty.length > 0) {
        return importConnections(thirdParty);
      }
      throw validation('Import file is not valid JSON or supported third-party format');
    }
  });

  // Settings
  registerHandler(IPC.SETTINGS_GET, (_event, key: string) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw validation(`Unknown setting key: ${key}`);
    }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  });

  registerHandler(IPC.SETTINGS_SET, (_event, { key, value }: { key: string; value: string }) => {
    if (!VALID_SETTINGS_KEYS.has(key)) {
      throw validation(`Unknown setting key: ${key}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw validation(`Setting ${key} must be JSON-encoded`);
    }
    if (!checkSettingType(key, parsed)) {
      throw validation(`Setting ${key} has wrong type`);
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

  registerHandler(IPC.SETTINGS_GET_ALL, () => {
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
