import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

// All vi.fn()/Map state is allocated *inside* the factories so vi.mock's
// top-level hoist doesn't capture uninitialised references. We then read
// them back through the (intercepted) module imports.
vi.mock('../../services/database', () => {
  const dbRows = new Map<string, unknown>();
  return {
    __dbRows: dbRows,
    getDatabase: () => ({
      prepare: () => ({ get: (id: string) => dbRows.get(id) }),
    }),
  };
});

vi.mock('../../services/credential-store', () => {
  const credentials = new Map<string, unknown>();
  return {
    __credentials: credentials,
    retrieveS3Credential: (id: string) => credentials.get(id) ?? null,
  };
});

vi.mock('../../services/s3/s3-provider', () => ({
  s3StorageProvider: {
    openSession: vi.fn(),
    closeSession: vi.fn(),
    listSessions: () => [],
  },
}));

vi.mock('../../services/storage/registry', () => ({
  storageRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    markClosing: vi.fn(),
    require: () => ({}),
  },
}));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@aws-sdk/client-s3', () => {
  const send = vi.fn();
  const destroy = vi.fn();
  class S3Client {
    constructor(public config: unknown) {}
    send(...args: unknown[]) {
      return send(...args);
    }
    destroy() {
      return destroy();
    }
  }
  class ListBucketsCommand {}
  return { S3Client, ListBucketsCommand, __send: send, __destroy: destroy };
});

import * as awsMock from '@aws-sdk/client-s3';
import * as credentialMock from '../../services/credential-store';
import * as databaseMock from '../../services/database';
import { s3StorageProvider } from '../../services/s3/s3-provider';
import { storageRegistry } from '../../services/storage/registry';
import { registerS3Handlers } from '../s3.ipc';

const dbRows = (databaseMock as unknown as { __dbRows: Map<string, Record<string, unknown>> })
  .__dbRows;
const credentials = (credentialMock as unknown as { __credentials: Map<string, unknown> })
  .__credentials;
const openSession = s3StorageProvider.openSession as unknown as ReturnType<typeof vi.fn>;
const closeSession = s3StorageProvider.closeSession as unknown as ReturnType<typeof vi.fn>;
const register = storageRegistry.register as unknown as ReturnType<typeof vi.fn>;
const unregister = storageRegistry.unregister as unknown as ReturnType<typeof vi.fn>;
const send = (awsMock as unknown as { __send: ReturnType<typeof vi.fn> }).__send;
const destroy = (awsMock as unknown as { __destroy: ReturnType<typeof vi.fn> }).__destroy;

beforeEach(() => {
  handlers.clear();
  dbRows.clear();
  credentials.clear();
  openSession.mockClear();
  closeSession.mockClear();
  register.mockClear();
  unregister.mockClear();
  send.mockReset();
  destroy.mockClear();
  registerS3Handlers();
});

describe('s3 IPC — connect', () => {
  it('rejects empty sessionId', async () => {
    await expect(
      handlers.get(IPC.S3_CONNECT)!({}, { sessionId: '', connectionId: 'c1' }),
    ).rejects.toThrow();
  });

  it('rejects empty connectionId', async () => {
    await expect(
      handlers.get(IPC.S3_CONNECT)!({}, { sessionId: 's1', connectionId: '' }),
    ).rejects.toThrow();
  });

  it('rejects unknown connectionId', async () => {
    await expect(
      handlers.get(IPC.S3_CONNECT)!({}, { sessionId: 's1', connectionId: 'missing' }),
    ).rejects.toThrow(/Connection not found/);
  });

  it('rejects when the row exists but is not an S3 connection', async () => {
    dbRows.set('c1', { id: 'c1', name: 'sftp', provider: 'sftp' });
    await expect(
      handlers.get(IPC.S3_CONNECT)!({}, { sessionId: 's1', connectionId: 'c1' }),
    ).rejects.toThrow(/not an S3 connection/);
  });

  it('rejects when credentials are missing', async () => {
    dbRows.set('c1', { id: 'c1', name: 'b', provider: 's3' });
    // no credential entry
    await expect(
      handlers.get(IPC.S3_CONNECT)!({}, { sessionId: 's1', connectionId: 'c1' }),
    ).rejects.toThrow(/credentials missing/);
  });

  it('opens a session and registers it with the storage registry', async () => {
    dbRows.set('c1', {
      id: 'c1',
      name: 'b',
      provider: 's3',
      endpoint: 'https://s3.example',
      region: 'us-east-1',
      default_bucket: 'mybucket',
      force_path_style: 1,
    });
    credentials.set('c1', { accessKeyId: 'AK', secretAccessKey: 'SK' });
    const result = await handlers.get(IPC.S3_CONNECT)!({}, { sessionId: 's1', connectionId: 'c1' });
    expect(result).toEqual({ sessionId: 's1' });
    expect(openSession).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        connectionId: 'c1',
        endpoint: 'https://s3.example',
        region: 'us-east-1',
        forcePathStyle: true,
        defaultBucket: 'mybucket',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
      }),
    );
    expect(register).toHaveBeenCalledWith('s1', expect.anything());
  });
});

describe('s3 IPC — disconnect', () => {
  it('rejects empty sessionId', async () => {
    await expect(handlers.get(IPC.S3_DISCONNECT)!({}, '')).rejects.toThrow();
  });

  it('closes the session and unregisters it', async () => {
    await handlers.get(IPC.S3_DISCONNECT)!({}, 's1');
    expect(closeSession).toHaveBeenCalledWith('s1');
    expect(unregister).toHaveBeenCalledWith('s1');
  });
});

describe('s3 IPC — test-connection', () => {
  it('rejects when both connectionId and config are provided', async () => {
    await expect(
      handlers.get(IPC.S3_TEST_CONNECTION)!(
        {},
        { connectionId: 'c1', config: { accessKeyId: 'AK', secretAccessKey: 'SK' } },
      ),
    ).rejects.toThrow(/either connectionId or config/);
  });

  it('rejects when neither is provided', async () => {
    await expect(handlers.get(IPC.S3_TEST_CONNECTION)!({}, {})).rejects.toThrow(/requires/);
  });

  it('rejects an oversized secretAccessKey via the field cap', async () => {
    const huge = 'x'.repeat(5000);
    await expect(
      handlers.get(IPC.S3_TEST_CONNECTION)!(
        {},
        { config: { accessKeyId: 'AK', secretAccessKey: huge } },
      ),
    ).rejects.toThrow(/secretAccessKey/);
  });

  it('returns ok:true on a successful ListBuckets', async () => {
    send.mockResolvedValue({ Buckets: [] });
    const result = await handlers.get(IPC.S3_TEST_CONNECTION)!(
      {},
      { config: { accessKeyId: 'AK', secretAccessKey: 'SK', region: 'us-east-1' } },
    );
    expect(result).toEqual({ ok: true });
    expect(destroy).toHaveBeenCalled();
  });

  it('returns ok:false with the error message when ListBuckets fails', async () => {
    send.mockRejectedValue(new Error('signature mismatch'));
    const result = await handlers.get(IPC.S3_TEST_CONNECTION)!(
      {},
      { config: { accessKeyId: 'AK', secretAccessKey: 'SK' } },
    );
    expect(result).toEqual({ ok: false, error: 'signature mismatch' });
    expect(destroy).toHaveBeenCalled();
  });

  it('uses connectionId path to load saved credentials', async () => {
    dbRows.set('c1', { id: 'c1', name: 'b', provider: 's3', region: 'eu-west-1' });
    credentials.set('c1', { accessKeyId: 'AK', secretAccessKey: 'SK' });
    send.mockResolvedValue({ Buckets: [] });
    const result = await handlers.get(IPC.S3_TEST_CONNECTION)!({}, { connectionId: 'c1' });
    expect(result).toEqual({ ok: true });
  });
});
