import type { _Object, S3ClientConfig } from '@aws-sdk/client-s3';
import type { StorageEntry } from '@shared/types/storage-provider';
import { AbortError, S3StorageError } from '../../lib/errors';

export interface S3ClientCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3ClientConfigInput {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials: S3ClientCredentials;
}

/**
 * Single source of truth for the S3Client constructor shape used across the
 * app. Both the long-lived session client and the short-lived test-connection
 * client go through here so credential/region/forcePathStyle defaults stay
 * in sync. Pass `fastFail: true` for connectivity probes — caps connect /
 * request timeouts and disables retries so an unreachable endpoint surfaces
 * a quick error instead of waiting ~30s × 3.
 */
export function buildS3ClientConfig(
  opts: S3ClientConfigInput,
  { fastFail = false }: { fastFail?: boolean } = {},
): S3ClientConfig {
  const base: S3ClientConfig = {
    region: opts.region || 'us-east-1',
    endpoint: opts.endpoint || undefined,
    forcePathStyle: opts.forcePathStyle ?? false,
    credentials: {
      accessKeyId: opts.credentials.accessKeyId,
      secretAccessKey: opts.credentials.secretAccessKey,
      sessionToken: opts.credentials.sessionToken,
    },
  };
  if (fastFail) {
    base.requestHandler = { requestTimeout: 10_000, connectionTimeout: 5_000 };
    base.maxAttempts = 1;
  }
  return base;
}

/**
 * Build a directory-like StorageEntry from an S3 CommonPrefix entry. S3
 * doesn't have folders — these are synthesised from key prefixes that end
 * with `/`. Kept separate from the provider so list-page rendering can be
 * unit-tested without booting the AWS SDK.
 */
export function prefixToEntry(bucket: string, fullPrefix: string, name: string): StorageEntry {
  return {
    name,
    path: `/${bucket}/${fullPrefix.replace(/\/$/, '')}`,
    size: 0,
    modifiedAt: 0,
    isDirectory: true,
    isSymlink: false,
    isPrefix: true,
  };
}

/**
 * Build a file StorageEntry from an S3 object descriptor.
 */
export function objectToEntry(bucket: string, obj: _Object, name: string): StorageEntry {
  return {
    name,
    path: `/${bucket}/${obj.Key ?? ''}`,
    size: obj.Size ?? 0,
    modifiedAt: obj.LastModified ? Math.floor(obj.LastModified.getTime() / 1000) : 0,
    isDirectory: false,
    isSymlink: false,
  };
}

/**
 * Normalise an arbitrary thrown value into an `S3StorageError` with a
 * user-readable message. Preserves abort and already-wrapped errors as-is.
 *
 * Specifically detects expired STS session tokens because AWS returns a
 * generic 403 message and users would otherwise chase a non-existent
 * network error instead of refreshing credentials.
 */
export function wrapS3Error(op: string, err: unknown): Error {
  if (err instanceof S3StorageError || err instanceof AbortError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code;
  if (code === 'ExpiredToken' || code === 'ExpiredTokenException' || /expired token/i.test(msg)) {
    return new S3StorageError(
      `S3 ${op} failed: AWS session token has expired. Re-enter credentials and reconnect.`,
      err,
    );
  }
  return new S3StorageError(`S3 ${op} failed: ${msg}`, err);
}
