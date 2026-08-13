import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `createConnection` used to validate far less than `updateConnection`: no
 * null-byte checks, no length caps, no authType allowlist, no port-forward
 * shape check. A value the update path rejected could still be written by
 * create and then read back everywhere. These tests pin both paths to the
 * same rules so the asymmetry can't quietly return.
 */

const rows = new Map<string, Record<string, unknown>>();
let lastInsertValues: unknown[] = [];

const fakeDb = {
  prepare(sql: string) {
    return {
      run: (...values: unknown[]) => {
        if (sql.includes('INSERT INTO connections')) {
          lastInsertValues = values;
          rows.set(values[0] as string, { id: values[0] });
        }
        return { changes: 1 };
      },
      get: (id: string) => storedRow(id),
      all: () => [],
    };
  },
  transaction: (fn: () => void) => () => fn(),
};

function storedRow(id: string): Record<string, unknown> {
  return {
    id,
    name: 'n',
    provider: 'sftp',
    host: 'h',
    port: 22,
    username: 'u',
    auth_type: 'password',
    private_key_path: null,
    endpoint: null,
    region: null,
    default_bucket: null,
    force_path_style: null,
    folder: 'default',
    color_tag: null,
    sort_order: 0,
    is_hidden: 0,
    last_connected_at: null,
    keepalive_interval: 0,
    keepalive_count_max: 3,
    port_forwards: '[]',
    created_at: 0,
    updated_at: 0,
  };
}

vi.mock('../../../src/main/services/database', () => ({
  getDatabase: () => fakeDb,
  CONNECTION_COLUMNS: 'id, name',
}));
vi.mock('../../../src/main/services/credential-store', () => ({
  storeCredential: vi.fn(),
  deleteCredential: vi.fn(),
  retrieveS3Credential: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../src/main/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

import { ConnectionService, rowToConnection } from '../../../src/main/services/connection-service';

const service = new ConnectionService();

const validSftp = {
  name: 'prod',
  provider: 'sftp' as const,
  host: 'example.com',
  port: 22,
  username: 'deploy',
  authType: 'password' as const,
};

beforeEach(() => {
  rows.clear();
  lastInsertValues = [];
});

describe('createConnection validation', () => {
  it('accepts a well-formed SFTP connection', () => {
    expect(() => service.createConnection(validSftp)).not.toThrow();
  });

  it.each([
    ['a null byte in the name', { ...validSftp, name: 'pro\0d' }],
    ['a null byte in the host', { ...validSftp, host: 'exam\0ple.com' }],
    ['a null byte in the folder', { ...validSftp, folder: 'fol\0der' }],
    ['an over-long name', { ...validSftp, name: 'x'.repeat(201) }],
    ['an over-long folder', { ...validSftp, folder: 'x'.repeat(101) }],
    ['an over-long host', { ...validSftp, host: 'x'.repeat(256) }],
    ['an invalid authType', { ...validSftp, authType: 'kerberos' as never }],
    ['a port of 0', { ...validSftp, port: 0 }],
    ['a port above 65535', { ...validSftp, port: 70000 }],
    ['a non-integer port', { ...validSftp, port: 22.5 }],
    ['an empty username', { ...validSftp, username: '   ' }],
    ['an unknown provider', { ...validSftp, provider: 'ftp' as never }],
  ])('rejects %s', (_label, input) => {
    expect(() => service.createConnection(input)).toThrow();
  });

  it('rejects a malformed portForwards entry at save time', () => {
    // Previously stored verbatim and only discovered when the session tried
    // to start the forward — by which point the user is long gone.
    expect(() =>
      service.createConnection({
        ...validSftp,
        portForwards: [{ type: 'local', localPort: 'not-a-number' } as never],
      }),
    ).toThrow();
  });

  it('normalises a missing folder to "default"', () => {
    service.createConnection({ ...validSftp, folder: '   ' });
    expect(lastInsertValues).toContain('default');
  });

  it('requires S3 credentials for an S3 connection', () => {
    expect(() =>
      service.createConnection({ name: 's3', provider: 's3', accessKeyId: 'AK' }),
    ).toThrow(/secretAccessKey/i);
  });
});

describe('updateConnection validation', () => {
  it.each([
    ['a null byte in the name', { name: 'a\0b' }],
    ['an over-long name', { name: 'x'.repeat(201) }],
    ['an over-long folder', { folder: 'x'.repeat(101) }],
    ['an invalid authType', { authType: 'kerberos' as never }],
    ['a port above 65535', { port: 99999 }],
    ['a non-array portForwards', { portForwards: 'nope' as never }],
    ['a malformed portForwards entry', { portForwards: [{ type: 'local' } as never] }],
  ])('rejects %s', (_label, patch) => {
    rows.set('c1', { id: 'c1' });
    expect(() => service.updateConnection({ id: 'c1', ...patch })).toThrow();
  });
});

describe('rowToConnection', () => {
  it('degrades to an empty list when port_forwards JSON is malformed', () => {
    // A bare JSON.parse here meant one bad row threw out of listConnections()
    // and blanked the whole sidebar — with no way to reach the connection and
    // fix it.
    const row = { ...storedRow('c1'), port_forwards: '{not json' } as never;
    expect(() => rowToConnection(row)).not.toThrow();
    expect(rowToConnection(row).portForwards).toEqual([]);
  });

  it('degrades to an empty list when port_forwards is not an array', () => {
    const row = { ...storedRow('c1'), port_forwards: '{"type":"local"}' } as never;
    expect(rowToConnection(row).portForwards).toEqual([]);
  });

  it('passes through a well-formed array', () => {
    const forwards = [{ id: 'a', type: 'local', bindAddress: '127.0.0.1', localPort: 1 }];
    const row = { ...storedRow('c1'), port_forwards: JSON.stringify(forwards) } as never;
    expect(rowToConnection(row).portForwards).toEqual(forwards);
  });
});

/**
 * The import path used to write straight to SQL with none of the rules
 * `createConnection` enforces — no length caps, no null-byte checks, no port
 * range, no authType allowlist, no port-forward validation. It is reachable
 * from `connection:import` and from any `.json` / `.ini` / `.mxtsessions`
 * file the user opens, so it is the least trustworthy input in the app and
 * had the weakest checks. Both paths now share `normaliseConnectionFields`.
 */
describe('importConnections validation parity', () => {
  const validExport = {
    name: 'imported',
    provider: 'sftp' as const,
    host: 'example.com',
    port: 22,
    username: 'deploy',
    authType: 'password' as const,
  };

  it('imports a well-formed entry', () => {
    const result = service.importConnections([validExport]);
    expect(result).toEqual({ imported: 1, skipped: [] });
  });

  it.each([
    ['an over-long name', { ...validExport, name: 'x'.repeat(201) }],
    ['a null byte in the host', { ...validExport, host: 'exam\0ple.com' }],
    ['an over-long folder', { ...validExport, folder: 'x'.repeat(101) }],
    ['a port of 0', { ...validExport, port: 0 }],
    ['a port above 65535', { ...validExport, port: 70000 }],
    ['a negative port', { ...validExport, port: -1 }],
    ['a non-integer port', { ...validExport, port: 22.5 }],
    ['an invalid authType', { ...validExport, authType: 'kerberos' as never }],
    ['a null byte in privateKeyPath', { ...validExport, privateKeyPath: 'k\0ey' }],
    ['an out-of-range keepaliveInterval', { ...validExport, keepaliveInterval: -5 }],
    [
      'a port forward with an out-of-range local port',
      {
        ...validExport,
        portForwards: [{ type: 'local', localPort: 99999, remotePort: 80 }] as never,
      },
    ],
    [
      'a port forward with an unknown type',
      { ...validExport, portForwards: [{ type: 'magic', localPort: 8080 }] as never },
    ],
  ])('skips an entry with %s instead of importing it', (_label, entry) => {
    const result = service.importConnections([entry]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].name).toBe(entry.name);
    // The user needs to know *why*, not just that something was dropped.
    expect(result.skipped[0].reason).toBeTruthy();
  });

  it('skips only the bad entry and imports the rest', () => {
    // One malformed row in a large export must not cost the user everything
    // else in the file.
    const result = service.importConnections([
      validExport,
      { ...validExport, name: 'bad', port: 70000 },
      { ...validExport, name: 'also-fine' },
    ]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([{ name: 'bad', reason: expect.stringContaining('port') }]);
  });

  it('applies SSH defaults for entries that legitimately omit them', () => {
    // ~/.ssh/config routinely omits Port and never states an auth type.
    const result = service.importConnections([
      { name: 'defaults', host: 'h.example.com', username: 'u' },
    ]);
    expect(result.imported).toBe(1);
    expect(lastInsertValues[4]).toBe(22); // port
    expect(lastInsertValues[6]).toBe('password'); // auth_type
  });

  it('normalises port forwards rather than storing them verbatim', () => {
    service.importConnections([
      {
        ...validExport,
        name: 'with-forward',
        portForwards: [{ type: 'local', localPort: 8080, remotePort: 80 }] as never,
      },
    ]);
    const stored = JSON.parse(lastInsertValues[17] as string);
    // Defaults are filled in by the validator, exactly as on the create path.
    expect(stored[0]).toMatchObject({
      type: 'local',
      localPort: 8080,
      remotePort: 80,
      bindAddress: '127.0.0.1',
      remoteHost: '127.0.0.1',
    });
  });

  it('never marks an imported connection hidden', () => {
    // Import ignores the exported isHidden flag: a hidden connection the user
    // can't see is indistinguishable from an import that silently failed.
    service.importConnections([{ ...validExport, isHidden: true }]);
    expect(lastInsertValues[14]).toBe(0);
  });

  it('rejects a non-array payload', () => {
    expect(() => service.importConnections('nope' as never)).toThrow(/must be an array/);
  });

  it('skips duplicates by name', () => {
    const result = service.importConnections([validExport, validExport]);
    expect(result.imported).toBe(1);
    expect(result.skipped[0].reason).toMatch(/already exists/);
  });
});

describe('renameFolder validation', () => {
  it('rejects an over-long folder name', () => {
    // Same column create and update cap at 100 chars; rename wrote to it
    // unchecked, so it was the way to get an oversized sidebar header in.
    expect(() =>
      service.renameFolder({ oldName: 'a', newName: 'x'.repeat(101), provider: 'sftp' }),
    ).toThrow(/at most/);
  });

  it('rejects a null byte in the new name', () => {
    expect(() =>
      service.renameFolder({ oldName: 'a', newName: 'fol\0der', provider: 'sftp' }),
    ).toThrow(/null bytes/);
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      service.renameFolder({ oldName: 'a', newName: 'b', provider: 'ftp' as never }),
    ).toThrow(/provider/);
  });

  it('accepts a well-formed rename', () => {
    expect(() =>
      service.renameFolder({ oldName: 'a', newName: 'b', provider: 'sftp' }),
    ).not.toThrow();
  });
});
