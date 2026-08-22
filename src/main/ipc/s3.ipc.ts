import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { IPC } from '@shared/constants';
import { ErrorCode, LunaError } from '@shared/errors';
import type { S3ConnectParams, S3TestConnectionConfig } from '@shared/types/storage-provider';
import { registerHandler } from '../lib/ipc-handler';
import log from '../lib/logger';
import { releaseStorageBucket } from '../lib/rate-limiter';
import { SlidingWindowLimiter } from '../lib/sliding-window-limiter';
import {
  assertBoundedInt,
  assertBoundedSecretFields,
  assertEitherConnectionOrConfig,
  assertNonEmptyString,
} from '../lib/validate';
import { retrieveS3Credential } from '../services/credential-store';
import { type ConnectionRow, getDatabase } from '../services/database';
import { buildS3ClientConfig } from '../services/s3/s3-helpers';
import { type S3SessionOptions, s3StorageProvider } from '../services/s3/s3-provider';
import { storageRegistry } from '../services/storage/registry';

/**
 * Hard cap on concurrent S3 sessions, mirroring MAX_SSH_SESSIONS in
 * ssh.ipc.ts. openSession() inserts into an unbounded map with nothing else
 * limiting growth, so a buggy or compromised renderer could otherwise open
 * unbounded S3Client sessions in a loop.
 */
const MAX_S3_SESSIONS = 64;

/**
 * Sliding-window limit on connect attempts, independent of the session cap
 * above — mirrors sshConnectLimiter in ssh.ipc.ts.
 */
const s3ConnectLimiter = new SlidingWindowLimiter(20, 60_000, 'S3 connect');

/** Test-only: reset the connect limiter between cases. */
export function __resetS3ConnectLimiter(): void {
  s3ConnectLimiter.reset();
}

/** AWS SigV4 refuses presigned URLs valid for more than 7 days. */
const MAX_PRESIGN_EXPIRY_SEC = 7 * 24 * 60 * 60;
/** Below a minute the URL is unusable by the time it reaches the clipboard. */
const MIN_PRESIGN_EXPIRY_SEC = 60;
const DEFAULT_PRESIGN_EXPIRY_SEC = 3600;

/**
 * Presigned URLs are bearer credentials, so minting them is rate-limited
 * independently of the ordinary storage token bucket: a renderer that can
 * generate them without limit can exfiltrate a whole bucket as shareable
 * links without ever transferring a byte through Luna.
 */
const presignLimiter = new SlidingWindowLimiter(30, 60_000, 'Presigned URL generation');

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

    s3ConnectLimiter.check();
    // Existing sessionId means this replaces an already-tracked session, not
    // a new one — only a genuinely new session counts against the cap.
    if (
      !s3StorageProvider.hasSession(params.sessionId) &&
      s3StorageProvider.sessionCount() >= MAX_S3_SESSIONS
    ) {
      throw new LunaError(
        `Too many S3 sessions open (max ${MAX_S3_SESSIONS}). Disconnect one and try again.`,
        ErrorCode.FORBIDDEN,
        { reason: 'session-limit', limit: MAX_S3_SESSIONS },
      );
    }

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
      assertEitherConnectionOrConfig(params.connectionId, params.config);
      let opts: S3SessionOptions;
      if (params.config) {
        const c = params.config;
        assertNonEmptyString(c.accessKeyId, 'accessKeyId');
        assertNonEmptyString(c.secretAccessKey, 'secretAccessKey');
        assertBoundedSecretFields({
          accessKeyId: c.accessKeyId,
          secretAccessKey: c.secretAccessKey,
          sessionToken: c.sessionToken,
        });
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
      } else {
        assertNonEmptyString(params.connectionId, 'connectionId');
        opts = loadConfig(params.connectionId);
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
      presignLimiter.check();
      assertNonEmptyString(params.sessionId, 'sessionId');
      assertNonEmptyString(params.path, 'path');
      // A presigned URL is a bearer token for the object: anyone holding it
      // can read the file for its whole lifetime, with no further auth. The
      // handler used to accept any number, so a renderer could mint a URL
      // valid for years — or hand the SDK a value it rejects with an opaque
      // signing error. SigV4 caps validity at 7 days; enforce that, and
      // require an explicit value rather than silently defaulting.
      const expiresSec = params.expiresSec ?? DEFAULT_PRESIGN_EXPIRY_SEC;
      assertBoundedInt(expiresSec, 'expiresSec', MIN_PRESIGN_EXPIRY_SEC, MAX_PRESIGN_EXPIRY_SEC);
      return s3StorageProvider.getPresignedUrl(params.sessionId, params.path, expiresSec);
    },
  );
}
