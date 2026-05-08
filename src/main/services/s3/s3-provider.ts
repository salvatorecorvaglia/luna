import { createReadStream, createWriteStream } from 'fs';
import { stat as fsStat, unlink } from 'fs/promises';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
  type CommonPrefix,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'stream';
import { LIMITS } from '@shared/constants';
import type { StorageEntry, StorageStatResult } from '@shared/types/storage-provider';
import type { StepCallback, StorageProvider } from '../storage/types';
import { AbortError, S3StorageError } from '../../lib/errors';
import { TimeoutError, withTimeout } from '../../lib/with-timeout';
import log from '../../lib/logger';
import { parseS3Path } from './s3-paths';

interface S3Session {
  client: S3Client;
  connectionId: string;
  connectionName: string;
  /** Optional default bucket — when set, the renderer typically opens here. */
  defaultBucket?: string;
}

export interface S3SessionOptions {
  connectionId: string;
  connectionName: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  defaultBucket?: string;
}

/**
 * Marker used by mkdir() to create a "folder" — S3 has no directories so we
 * write a zero-byte object whose key ends with `/`. The console + most tools
 * recognise this convention.
 */
const FOLDER_MARKER_SUFFIX = '/';

class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const;
  private sessions = new Map<string, S3Session>();

  openSession(sessionId: string, opts: S3SessionOptions): void {
    const client = new S3Client({
      region: opts.region || 'us-east-1',
      endpoint: opts.endpoint || undefined,
      forcePathStyle: opts.forcePathStyle ?? false,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        sessionToken: opts.sessionToken,
      },
    });
    this.sessions.set(sessionId, {
      client,
      connectionId: opts.connectionId,
      connectionName: opts.connectionName,
      defaultBucket: opts.defaultBucket,
    });
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.client.destroy();
      } catch {
        // ignore double-destroy
      }
      this.sessions.delete(sessionId);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private requireClient(sessionId: string): S3Client {
    const s = this.sessions.get(sessionId);
    if (!s) throw new S3StorageError(`S3 session not found: ${sessionId}`);
    return s.client;
  }

  private async runOp<T>(
    sessionId: string,
    op: string,
    fn: (client: S3Client) => Promise<T>,
    timeoutMs: number = LIMITS.SFTP_OP_TIMEOUT_MS,
  ): Promise<T> {
    const client = this.requireClient(sessionId);
    try {
      return await withTimeout(fn(client), timeoutMs, `s3:${op}`);
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new S3StorageError(`S3 ${op} operation timed out after ${timeoutMs}ms`, err);
      }
      throw err;
    }
  }

  async list(sessionId: string, path: string): Promise<StorageEntry[]> {
    return this.runOp(sessionId, 'list', async (client) => {
      const { bucket, key } = parseS3Path(path);

      if (!bucket) {
        // Root: list buckets.
        try {
          const out = await client.send(new ListBucketsCommand({}));
          const now = Math.floor(Date.now() / 1000);
          return (out.Buckets ?? []).map((b) => ({
            name: b.Name ?? '',
            path: `/${b.Name ?? ''}`,
            size: 0,
            modifiedAt: b.CreationDate ? Math.floor(b.CreationDate.getTime() / 1000) : now,
            isDirectory: true,
            isSymlink: false,
            isPrefix: true,
          }));
        } catch (err) {
          throw this.wrapError('list-buckets', err);
        }
      }

      // List objects + common prefixes within `bucket` at `key/` (or root).
      const prefix = key ? (key.endsWith('/') ? key : `${key}/`) : '';
      const entries: StorageEntry[] = [];
      let ContinuationToken: string | undefined;
      try {
        do {
          const out = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              Delimiter: '/',
              ContinuationToken,
            }),
          );
          for (const cp of out.CommonPrefixes ?? []) {
            const full = cp.Prefix ?? '';
            // strip the listing prefix and the trailing slash
            const name = full.slice(prefix.length).replace(/\/$/, '');
            if (!name) continue;
            entries.push(this.prefixToEntry(bucket, full, name));
          }
          for (const obj of out.Contents ?? []) {
            // Skip the folder-marker key itself (matches the listing prefix).
            if (obj.Key === prefix) continue;
            const name = (obj.Key ?? '').slice(prefix.length);
            if (!name) continue;
            // Treat trailing-slash markers as prefix entries to avoid showing
            // them as zero-byte files alongside the prefix they represent.
            if (name.endsWith('/')) continue;
            entries.push(this.objectToEntry(bucket, obj, name));
          }
          ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
        } while (ContinuationToken);
      } catch (err) {
        throw this.wrapError('list-objects', err);
      }
      return entries;
    });
  }

  private prefixToEntry(bucket: string, fullPrefix: string, name: string): StorageEntry {
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

  private objectToEntry(bucket: string, obj: _Object, name: string): StorageEntry {
    return {
      name,
      path: `/${bucket}/${obj.Key ?? ''}`,
      size: obj.Size ?? 0,
      modifiedAt: obj.LastModified ? Math.floor(obj.LastModified.getTime() / 1000) : 0,
      isDirectory: false,
      isSymlink: false,
    };
  }

  async stat(sessionId: string, path: string): Promise<StorageStatResult> {
    return this.runOp(sessionId, 'stat', async (client) => {
      const { bucket, key } = parseS3Path(path);
      if (!bucket) {
        return { size: 0, modifiedAt: 0, isDirectory: true, isSymlink: false };
      }
      if (!key) {
        // bucket root — treat as directory
        return { size: 0, modifiedAt: 0, isDirectory: true, isSymlink: false };
      }
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          size: out.ContentLength ?? 0,
          modifiedAt: out.LastModified ? Math.floor(out.LastModified.getTime() / 1000) : 0,
          isDirectory: false,
          isSymlink: false,
        };
      } catch (err) {
        // Maybe it's a prefix (logical directory) — verify with a 1-key list.
        try {
          const probe = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: key.endsWith('/') ? key : `${key}/`,
              MaxKeys: 1,
            }),
          );
          if ((probe.KeyCount ?? 0) > 0) {
            return { size: 0, modifiedAt: 0, isDirectory: true, isSymlink: false };
          }
        } catch {
          // fall through to throw the original head error
        }
        throw this.wrapError('stat', err);
      }
    });
  }

  async statSize(sessionId: string, path: string): Promise<number> {
    const { bucket, key } = parseS3Path(path);
    if (!bucket || !key) return 0;
    const client = this.requireClient(sessionId);
    try {
      const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return out.ContentLength ?? 0;
    } catch (err) {
      throw this.wrapError('stat-size', err);
    }
  }

  async mkdir(sessionId: string, path: string): Promise<void> {
    return this.runOp(sessionId, 'mkdir', async (client) => {
      const { bucket, key } = parseS3Path(path);
      if (!bucket) {
        throw new S3StorageError('Cannot create a directory at the root — create a bucket instead');
      }
      if (!key) {
        // top-level: create the bucket itself
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (err) {
          throw this.wrapError('create-bucket', err);
        }
        return;
      }
      const markerKey = key.endsWith(FOLDER_MARKER_SUFFIX) ? key : `${key}${FOLDER_MARKER_SUFFIX}`;
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: markerKey, Body: '' }));
      } catch (err) {
        throw this.wrapError('mkdir', err);
      }
    });
  }

  async rename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    return this.runOp(sessionId, 'rename', async (client) => {
      const a = parseS3Path(oldPath);
      const b = parseS3Path(newPath);
      if (!a.bucket || !b.bucket) {
        throw new S3StorageError('Cannot rename buckets — create a new bucket and copy contents');
      }
      if (!a.key && !b.key) {
        throw new S3StorageError('Bucket-level rename is not supported');
      }
      try {
        const encodedKey = a.key.split('/').map(encodeURIComponent).join('/');
        await client.send(
          new CopyObjectCommand({
            Bucket: b.bucket,
            Key: b.key,
            CopySource: `/${a.bucket}/${encodedKey}`,
          }),
        );
        await client.send(new DeleteObjectCommand({ Bucket: a.bucket, Key: a.key }));
      } catch (err) {
        throw this.wrapError('rename', err);
      }
    });
  }

  async remove(sessionId: string, path: string, isDirectory: boolean): Promise<void> {
    const client = this.requireClient(sessionId);
    const { bucket, key } = parseS3Path(path);
    if (!bucket) throw new S3StorageError('Cannot delete the root');

    if (!key) {
      // bucket-level delete: must be empty
      try {
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      } catch (err) {
        throw this.wrapError('delete-bucket', err);
      }
      return;
    }

    if (!isDirectory) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        throw this.wrapError('delete-object', err);
      }
      return;
    }

    // Prefix delete: paginated ListObjectsV2 → DeleteObjects in batches of 1000.
    const prefix = key.endsWith('/') ? key : `${key}/`;
    let ContinuationToken: string | undefined;
    try {
      do {
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }),
        );
        const objects = (listed.Contents ?? [])
          .map((o) => o.Key)
          .filter((k): k is string => Boolean(k));
        if (objects.length > 0) {
          // Quiet:false so the response always includes Errors[] when present;
          // a partial success would otherwise be invisible and the caller
          // would believe the prefix was fully wiped.
          const result = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: false },
            }),
          );
          const errors = result.Errors ?? [];
          if (errors.length > 0) {
            const sample = errors
              .slice(0, 3)
              .map((e) => `${e.Key ?? '<unknown>'}: ${e.Code ?? ''} ${e.Message ?? ''}`.trim())
              .join('; ');
            throw new S3StorageError(
              `Bulk delete partially failed (${errors.length} of ${objects.length} objects): ${sample}${
                errors.length > 3 ? ' …' : ''
              }`,
            );
          }
        }
        ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (ContinuationToken);
    } catch (err) {
      throw this.wrapError('delete-prefix', err);
    }
  }

  async readFile(
    sessionId: string,
    path: string,
    maxSize?: number,
  ): Promise<{ content: string; encoding: 'utf-8' | 'base64' }> {
    return this.runOp(sessionId, 'readFile', async (client) => {
      const { bucket, key } = parseS3Path(path);
      if (!bucket || !key) throw new S3StorageError('Cannot read a non-key path');
      const limit = Math.min(maxSize || LIMITS.MAX_PREVIEW_BYTES, LIMITS.MAX_PREVIEW_BYTES);

      let head;
      try {
        head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        throw this.wrapError('read-head', err);
      }
      if ((head.ContentLength ?? 0) > limit) {
        throw new S3StorageError(
          `File too large to preview: ${head.ContentLength} bytes (max ${limit}). Download it instead.`,
        );
      }

      try {
        const out = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${limit - 1}` }),
        );
        const body = out.Body as Readable | undefined;
        if (!body) throw new S3StorageError('Empty response body');
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        const ext = key.split('.').pop()?.toLowerCase() || '';
        const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'pdf'];
        const isBinary = binaryExts.includes(ext);

        return {
          content: buffer.toString(isBinary ? 'base64' : 'utf-8'),
          encoding: isBinary ? 'base64' : 'utf-8',
        };
      } catch (err) {
        throw this.wrapError('read-object', err);
      }
    });
  }

  async streamDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.requireClient(sessionId);
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || !key) throw new S3StorageError('Cannot download a non-key path');

    const cleanupPartial = async (): Promise<void> => {
      await unlink(localPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
          log.warn(`[S3] Failed to remove partial download ${localPath}:`, err.message);
        }
      });
    };

    if (signal.aborted) throw new AbortError('Transfer cancelled');

    let total = 0;
    let body: Readable;
    try {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: signal,
      });
      total = out.ContentLength ?? 0;
      body = out.Body as Readable;
      if (!body) throw new S3StorageError('Empty response body');
    } catch (err) {
      if (signal.aborted) throw new AbortError('Transfer cancelled');
      throw this.wrapError('download-get', err);
    }

    const writeStream = createWriteStream(localPath);
    let transferred = 0;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = (): void => {
        body.destroy();
        writeStream.destroy();
        settle(() => cleanupPartial().finally(() => reject(new AbortError('Transfer cancelled'))));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      body.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        onStep(transferred, chunk.length, total);
      });
      body.on('error', (err) => {
        writeStream.destroy();
        settle(() =>
          cleanupPartial().finally(() => reject(this.wrapError('download-stream', err))),
        );
      });
      writeStream.on('error', (err) => {
        body.destroy();
        settle(() => cleanupPartial().finally(() => reject(err)));
      });
      writeStream.on('finish', () => settle(() => resolve()));

      body.pipe(writeStream);
    });
  }

  async streamUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onStep: StepCallback,
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.requireClient(sessionId);
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || !key) throw new S3StorageError('Cannot upload to a non-key path');

    if (signal.aborted) throw new AbortError('Transfer cancelled');

    let total = 0;
    try {
      const stats = await fsStat(localPath);
      total = stats.size;
    } catch {
      // size unknown — onStep will still report `loaded` from the SDK.
    }

    const body = createReadStream(localPath);
    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: key, Body: body },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });

    upload.on('httpUploadProgress', (p) => {
      const transferred = p.loaded ?? 0;
      onStep(transferred, 0, total || (p.total ?? 0));
    });

    const onAbort = (): void => {
      void upload.abort();
      body.destroy();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await upload.done();
    } catch (err) {
      if (signal.aborted) throw new AbortError('Transfer cancelled');
      throw this.wrapError('upload', err);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private wrapError(op: string, err: unknown): Error {
    if (err instanceof S3StorageError || err instanceof AbortError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    // STS session tokens silently expire, after which every request fails
    // with ExpiredToken / 403. Surface that explicitly so users don't chase
    // network errors when the real issue is a stale temporary credential.
    const code =
      (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code;
    if (code === 'ExpiredToken' || code === 'ExpiredTokenException' || /expired token/i.test(msg)) {
      return new S3StorageError(
        `S3 ${op} failed: AWS session token has expired. Re-enter credentials and reconnect.`,
        err,
      );
    }
    return new S3StorageError(`S3 ${op} failed: ${msg}`, err);
  }

  listSessions(): {
    id: string;
    connectionId: string;
    connectionName: string;
    initialPath: string;
  }[] {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      connectionId: s.connectionId,
      connectionName: s.connectionName,
      initialPath: s.defaultBucket ? `/${s.defaultBucket}` : '/',
    }));
  }
}

export const s3StorageProvider = new S3StorageProvider();
// Re-export type for IPC handlers
export type { CommonPrefix };
