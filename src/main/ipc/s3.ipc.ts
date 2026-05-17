import { IPC } from '@shared/constants';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { type ConnectionRow, getDatabase } from '../services/database';
import { retrieveS3Credential } from '../services/credential-store';
import { storageRegistry } from '../services/storage/registry';
import { s3StorageProvider, type S3SessionOptions } from '../services/s3/s3-provider';
import { ErrorCode, LunarError } from '@shared/errors';
import { assertNonEmptyString } from '../lib/validate';
import { releaseStorageBucket } from '../lib/rate-limiter';
import { registerHandler } from '../lib/ipc-handler';
import type { S3ConnectParams, S3TestConnectionConfig } from '@shared/types/storage-provider';
import log from '../lib/logger';

const MAX_SECRET_LEN = 4096;

function loadConfig(connectionId: string): S3SessionOptions {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT name, provider, endpoint, region, default_bucket, force_path_style
       FROM connections WHERE id = ?`,
    )
    .get(connectionId) as
    | Pick<
        ConnectionRow,
        'name' | 'provider' | 'endpoint' | 'region' | 'default_bucket' | 'force_path_style'
      >
    | undefined;
  if (!row) throw new LunarError(`Connection not found: ${connectionId}`, ErrorCode.NOT_FOUND);
  if (row.provider !== 's3') {
    throw new LunarError(
      `Connection ${connectionId} is not an S3 connection`,
      ErrorCode.VALIDATION_ERROR,
    );
  }
  const cred = retrieveS3Credential(connectionId);
  if (!cred) {
    throw new LunarError(
      'S3 credentials missing or corrupt — re-enter them in the connection form',
      ErrorCode.UNAUTHORIZED,
    );
  }
  return {
    connectionId,
    connectionName: row.name,
    endpoint: row.endpoint || undefined,
    region: row.region || undefined,
    forcePathStyle: row.force_path_style === 1,
    accessKeyId: cred.accessKeyId,
    secretAccessKey: cred.secretAccessKey,
    sessionToken: cred.sessionToken,
    defaultBucket: row.default_bucket || undefined,
  };
}

export function registerS3Handlers(): void {
  registerHandler(IPC.S3_CONNECT, (_event, params: S3ConnectParams) => {
    assertNonEmptyString(params.sessionId, 'sessionId');
    assertNonEmptyString(params.connectionId, 'connectionId');
    const opts = loadConfig(params.connectionId);
    s3StorageProvider.openSession(params.sessionId, opts);
    storageRegistry.register(params.sessionId, s3StorageProvider);
    return { sessionId: params.sessionId };
  });

  registerHandler(IPC.S3_DISCONNECT, (_event, sessionId: string) => {
    assertNonEmptyString(sessionId, 'sessionId');
    // Mark closing first so a concurrent storage IPC sees the closing state
    // and fails fast instead of receiving a provider whose S3Client is being
    // destroyed under it.
    storageRegistry.markClosing(sessionId);
    s3StorageProvider.closeSession(sessionId);
    storageRegistry.unregister(sessionId);
    releaseStorageBucket(sessionId);
  });

  registerHandler(
    IPC.S3_TEST_CONNECTION,
    async (
      _event,
      params: { connectionId?: string; config?: S3TestConnectionConfig },
    ): Promise<{ ok: boolean; error?: string }> => {
      // Match the SSH semantics: don't accept transient secrets alongside a
      // saved connectionId — the renderer must pick one path explicitly.
      if (params.connectionId && params.config) {
        throw new LunarError(
          'testConnection accepts either connectionId or config, not both',
          ErrorCode.VALIDATION_ERROR,
        );
      }
      let opts: S3SessionOptions;
      if (params.config) {
        const c = params.config;
        assertNonEmptyString(c.accessKeyId, 'accessKeyId');
        assertNonEmptyString(c.secretAccessKey, 'secretAccessKey');
        for (const [k, v] of Object.entries({
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          sessionToken: c.sessionToken,
        })) {
          if (v === undefined) continue;
          if (typeof v !== 'string' || v.length > MAX_SECRET_LEN) {
            throw new LunarError(
              `${k} must be a string up to ${MAX_SECRET_LEN} characters`,
              ErrorCode.VALIDATION_ERROR,
            );
          }
        }
        opts = {
          connectionId: 'test-connection',
          connectionName: 'Test Connection',
          endpoint: c.endpoint,
          region: c.region,
          forcePathStyle: c.forcePathStyle ?? false,
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          sessionToken: c.sessionToken,
        };
      } else if (params.connectionId) {
        assertNonEmptyString(params.connectionId, 'connectionId');
        opts = loadConfig(params.connectionId);
      } else {
        throw new LunarError(
          'testConnection requires connectionId or config',
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const client = new S3Client({
        region: opts.region || 'us-east-1',
        endpoint: opts.endpoint || undefined,
        forcePathStyle: opts.forcePathStyle ?? false,
        // Cap connect/request time so an unreachable endpoint surfaces a
        // quick error instead of hanging on the default ~30s TCP timeout.
        requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
        // Don't retry — the user is testing the connection; a failure should
        // be returned immediately, not amplified into 3× 10s waits.
        maxAttempts: 1,
        credentials: {
          accessKeyId: opts.accessKeyId,
          secretAccessKey: opts.secretAccessKey,
          sessionToken: opts.sessionToken,
        },
      });
      try {
        await client.send(new ListBucketsCommand({}));
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('[S3] test-connection failed:', msg);
        return { ok: false, error: msg };
      } finally {
        try {
          client.destroy();
        } catch {
          // ignore
        }
      }
    },
  );
}
