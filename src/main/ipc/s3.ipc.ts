import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { IPC } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import type { S3ConnectParams, S3TestConnectionConfig } from '@shared/types/storage-provider';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { releaseStorageBucket } from '../lib/rate-limiter';
import { assertNonEmptyString } from '../lib/validate';
import { retrieveS3Credential } from '../services/credential-store';
import { type ConnectionRow, getDatabase } from '../services/database';
import { buildS3ClientConfig } from '../services/s3/s3-helpers';
import { type S3SessionOptions, s3StorageProvider } from '../services/s3/s3-provider';
import { storageRegistry } from '../services/storage/registry';

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
  if (!row) throw new LunaError(`Connection not found: ${connectionId}`, ErrorCode.NOT_FOUND);
  if (row.provider !== 's3') {
    throw new LunaError(
      `Connection ${connectionId} is not an S3 connection`,
      ErrorCode.VALIDATION_ERROR,
    );
  }
  const cred = retrieveS3Credential(connectionId);
  if (!cred) {
    throw new LunaError(
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
        throw new LunaError(
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
            throw new LunaError(
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
        throw new LunaError(
          'testConnection requires connectionId or config',
          ErrorCode.VALIDATION_ERROR,
        );
      }

      // fastFail=true caps timeouts to 10s/5s and disables retries so an
      // unreachable endpoint returns a quick error instead of hanging on the
      // SDK's default ~30s × 3 attempts.
      const client = new S3Client(
        buildS3ClientConfig(
          {
            region: opts.region,
            endpoint: opts.endpoint,
            forcePathStyle: opts.forcePathStyle,
            credentials: {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
              sessionToken: opts.sessionToken,
            },
          },
          { fastFail: true },
        ),
      );
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

  registerHandler(
    IPC.S3_GENERATE_PRESIGNED_URL,
    async (
      _event,
      params: { sessionId: string; path: string; expiresSec: number },
    ): Promise<string> => {
      assertNonEmptyString(params.sessionId, 'sessionId');
      assertNonEmptyString(params.path, 'path');
      const expiresSec = params.expiresSec || 3600;
      return s3StorageProvider.getPresignedUrl(params.sessionId, params.path, expiresSec);
    },
  );
}
