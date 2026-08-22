import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lower the truncation cap so a truncated-list test doesn't need to
// materialize tens of thousands of fake S3 objects. Applies file-wide; no
// other test in this file lists more than a couple of entries.
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>();
  return { ...actual, LIMITS: { ...actual.LIMITS, MAX_S3_LIST_ENTRIES: 2 } };
});

vi.mock('../../../../src/main/services/emit', () => ({
  emitToRenderer: vi.fn(),
}));

const { FakeS3Client, s3Send } = vi.hoisted(() => {
  const s3Send = vi.fn();
  class FakeS3Client {
    send = s3Send;
    destroy = vi.fn();
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  }
  return { FakeS3Client, s3Send };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return { ...actual, S3Client: FakeS3Client };
});

const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example.com/object');
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));

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
} from '@aws-sdk/client-s3';
import { emitToRenderer } from '../../../../src/main/services/emit';
import { s3StorageProvider } from '../../../../src/main/services/s3/s3-provider';
import { IPC } from '../../../../src/shared/constants';

function commandName(cmd: unknown): string {
  return (cmd as { constructor: { name: string } }).constructor.name;
}

const SESSION_OPTS = {
  connectionId: 'conn-1',
  connectionName: 'Test S3',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
};

beforeEach(() => {
  s3Send.mockReset();
  getSignedUrl.mockClear();
  (emitToRenderer as ReturnType<typeof vi.fn>).mockClear();
  s3StorageProvider.openSession('sess', SESSION_OPTS);
});

afterEach(() => {
  s3StorageProvider.closeSession('sess');
});

describe('S3StorageProvider — session lifecycle', () => {
  it('identifies provider kind as s3', () => {
    expect(s3StorageProvider.kind).toBe('s3');
  });

  it('reports false for hasSession with non-existent session', () => {
    expect(s3StorageProvider.hasSession('non-existent-session')).toBe(false);
  });

  it('opens and tracks active sessions', () => {
    s3StorageProvider.openSession('extra', SESSION_OPTS);
    expect(s3StorageProvider.hasSession('extra')).toBe(true);
    expect(s3StorageProvider.listSessions()).toContainEqual({
      id: 'extra',
      connectionId: 'conn-1',
      connectionName: 'Test S3',
      initialPath: '/',
    });
    s3StorageProvider.closeSession('extra');
    expect(s3StorageProvider.hasSession('extra')).toBe(false);
  });

  it('throws S3StorageError when operating on closed session', async () => {
    await expect(s3StorageProvider.stat('closed-session', '/bucket/key')).rejects.toThrow(
      'S3 session not found: closed-session',
    );
  });
});

describe('S3StorageProvider — list', () => {
  it('lists buckets at the root', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(ListBucketsCommand.name);
      return { Buckets: [{ Name: 'bucket-a', CreationDate: new Date(0) }] };
    });

    const entries = await s3StorageProvider.list('sess', '/');
    expect(entries).toEqual([
      expect.objectContaining({ name: 'bucket-a', isDirectory: true, isPrefix: true }),
    ]);
  });

  it('wraps a list-buckets SDK failure', async () => {
    s3Send.mockRejectedValue(Object.assign(new Error('access denied'), { name: 'AccessDenied' }));

    await expect(s3StorageProvider.list('sess', '/')).rejects.toThrow(/S3 list-buckets failed/);
  });

  it('paginates ListObjectsV2 across ContinuationToken pages', async () => {
    s3Send
      .mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'folder-a/' }],
        Contents: [],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      })
      .mockResolvedValueOnce({
        CommonPrefixes: [],
        Contents: [{ Key: 'file-a.txt', Size: 10, LastModified: new Date(0) }],
        IsTruncated: false,
      });

    const entries = await s3StorageProvider.list('sess', '/bucket-a');
    expect(entries.map((e) => e.name)).toEqual(['folder-a', 'file-a.txt']);
    expect(s3Send).toHaveBeenCalledTimes(2);
  });

  it('truncates at the configured cap and emits a truncation event', async () => {
    // MAX_S3_LIST_ENTRIES is mocked to 2 for this file.
    s3Send.mockResolvedValueOnce({
      CommonPrefixes: [],
      Contents: [
        { Key: 'a.txt', Size: 1 },
        { Key: 'b.txt', Size: 1 },
        { Key: 'c.txt', Size: 1 },
      ],
      IsTruncated: false,
    });

    const entries = await s3StorageProvider.list('sess', '/bucket-a');
    expect(entries).toHaveLength(2);
    expect(emitToRenderer).toHaveBeenCalledWith(
      IPC.STORAGE_LIST_TRUNCATED,
      expect.objectContaining({ sessionId: 'sess', returned: 2, limit: 2 }),
    );
  });
});

describe('S3StorageProvider — stat', () => {
  it('returns file metadata for an existing object', async () => {
    s3Send.mockResolvedValue({ ContentLength: 42, LastModified: new Date(0) });

    const result = await s3StorageProvider.stat('sess', '/bucket-a/file.txt');
    expect(result).toEqual({ size: 42, modifiedAt: 0, isDirectory: false, isSymlink: false });
  });

  it('falls back to a prefix probe and reports a directory when HeadObject 404s', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      if (commandName(cmd) === HeadObjectCommand.name) {
        throw Object.assign(new Error('not found'), { name: 'NotFound' });
      }
      return { KeyCount: 3 };
    });

    const result = await s3StorageProvider.stat('sess', '/bucket-a/some-folder');
    expect(result).toEqual({ size: 0, modifiedAt: 0, isDirectory: true, isSymlink: false });
  });

  it('wraps the original HeadObject error when the prefix probe also finds nothing', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      if (commandName(cmd) === HeadObjectCommand.name) {
        throw Object.assign(new Error('not found'), { name: 'NotFound' });
      }
      return { KeyCount: 0 };
    });

    await expect(s3StorageProvider.stat('sess', '/bucket-a/missing')).rejects.toThrow(
      /S3 stat failed: not found/,
    );
  });
});

describe('S3StorageProvider — mkdir', () => {
  it('creates a bucket when the path has no key', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(CreateBucketCommand.name);
      return {};
    });
    await s3StorageProvider.mkdir('sess', '/new-bucket');
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it('writes a zero-byte folder-marker object for a key path', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(PutObjectCommand.name);
      expect((cmd as PutObjectCommand).input.Key).toBe('sub/folder/');
      return {};
    });
    await s3StorageProvider.mkdir('sess', '/bucket-a/sub/folder');
  });

  it('rejects creating a directory at the root', async () => {
    await expect(s3StorageProvider.mkdir('sess', '/')).rejects.toThrow(/create a bucket instead/);
    expect(s3Send).not.toHaveBeenCalled();
  });
});

describe('S3StorageProvider — rename', () => {
  it('copies then deletes the source object', async () => {
    const calls: string[] = [];
    s3Send.mockImplementation(async (cmd: unknown) => {
      calls.push(commandName(cmd));
      return {};
    });

    await s3StorageProvider.rename('sess', '/bucket-a/old.txt', '/bucket-a/new.txt');
    expect(calls).toEqual([CopyObjectCommand.name, DeleteObjectCommand.name]);
  });

  it('rejects a bucket-level rename', async () => {
    await expect(s3StorageProvider.rename('sess', '/bucket-a', '/bucket-b')).rejects.toThrow(
      /Bucket-level rename is not supported/,
    );
  });
});

describe('S3StorageProvider — remove', () => {
  it('deletes a single object', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(DeleteObjectCommand.name);
      return {};
    });
    await s3StorageProvider.remove('sess', '/bucket-a/file.txt', false);
  });

  it('deletes a bucket at the root', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(DeleteBucketCommand.name);
      return {};
    });
    await s3StorageProvider.remove('sess', '/bucket-a', false);
  });

  it('paginated-deletes a prefix in batches', async () => {
    const calls: string[] = [];
    s3Send.mockImplementation(async (cmd: unknown) => {
      const name = commandName(cmd);
      calls.push(name);
      if (name === ListObjectsV2Command.name) {
        return { Contents: [{ Key: 'folder/a.txt' }], IsTruncated: false };
      }
      return { Errors: [] };
    });

    await s3StorageProvider.remove('sess', '/bucket-a/folder', true);
    expect(calls).toEqual([ListObjectsV2Command.name, DeleteObjectsCommand.name]);
  });

  it('surfaces a partial bulk-delete failure instead of reporting silent success', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      const name = commandName(cmd);
      if (name === ListObjectsV2Command.name) {
        return { Contents: [{ Key: 'folder/a.txt' }], IsTruncated: false };
      }
      return {
        Errors: [{ Key: 'folder/a.txt', Code: 'AccessDenied', Message: 'denied' }],
      };
    });

    await expect(s3StorageProvider.remove('sess', '/bucket-a/folder', true)).rejects.toThrow(
      /Bulk delete partially failed \(1 of 1 objects\)/,
    );
  });
});

describe('S3StorageProvider — readFile / writeFile', () => {
  it('rejects reading a file larger than the preview cap', async () => {
    s3Send.mockResolvedValue({ ContentLength: 999_999_999 });

    await expect(s3StorageProvider.readFile('sess', '/bucket-a/huge.bin')).rejects.toThrow(
      /too large to preview/,
    );
  });

  it('wraps a write failure', async () => {
    s3Send.mockImplementation(async (cmd: unknown) => {
      expect(commandName(cmd)).toBe(PutObjectCommand.name);
      throw new Error('bucket does not exist');
    });

    await expect(s3StorageProvider.writeFile('sess', '/bucket-a/f.txt', 'hi')).rejects.toThrow(
      /S3 write-object failed: bucket does not exist/,
    );
  });
});

describe('S3StorageProvider — getPresignedUrl', () => {
  it('builds a GetObjectCommand for the parsed bucket/key and delegates to getSignedUrl', async () => {
    const url = await s3StorageProvider.getPresignedUrl('sess', '/bucket-a/file.txt', 300);
    expect(url).toBe('https://signed.example.com/object');

    const [, command, opts] = getSignedUrl.mock.calls[0];
    expect(commandName(command)).toBe(GetObjectCommand.name);
    expect((command as GetObjectCommand).input).toEqual({ Bucket: 'bucket-a', Key: 'file.txt' });
    expect(opts).toEqual({ expiresIn: 300 });
  });
});

describe('S3StorageProvider — op timeout', () => {
  it('converts a hung operation into a timed-out S3StorageError', async () => {
    vi.useFakeTimers();
    try {
      s3Send.mockImplementation(() => new Promise(() => {})); // never resolves
      const pending = s3StorageProvider.stat('sess', '/bucket-a/f.txt');
      const assertion = expect(pending).rejects.toThrow(/timed out after 30000ms/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
