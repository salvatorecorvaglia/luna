import { ErrorCode } from '@shared/errors';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  isLoopbackAddress,
  parseStoredPortForwards,
  validatePortForwardConfig,
} from '../port-forward-config';

const localForward = {
  id: 'pf-1',
  type: 'local',
  bindAddress: '127.0.0.1',
  localPort: 8080,
  remoteHost: 'db.internal',
  remotePort: 5432,
};

describe('isLoopbackAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    // The whole 127/8 block is loopback, not just .0.1 — a check that only
    // matched 127.0.0.1 would wrongly treat 127.0.0.2 as a public bind.
    '127.0.0.2',
    'localhost',
    'LOCALHOST',
    '::1',
    '[::1]',
  ])('treats %s as loopback', (address) => {
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each(['0.0.0.0', '192.168.1.10', '10.0.0.1', '::', 'example.com', '128.0.0.1'])(
    'treats %s as non-loopback',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(false);
    },
  );
});

describe('validatePortForwardConfig', () => {
  it('accepts a well-formed local forward and returns a normalised copy', () => {
    expect(validatePortForwardConfig(localForward)).toEqual({
      id: 'pf-1',
      type: 'local',
      bindAddress: '127.0.0.1',
      localPort: 8080,
      remoteHost: 'db.internal',
      remotePort: 5432,
    });
  });

  it('defaults a missing bindAddress to loopback', () => {
    const { bindAddress } = validatePortForwardConfig({
      type: 'local',
      localPort: 9000,
      remotePort: 80,
    });
    expect(bindAddress).toBe('127.0.0.1');
  });

  it('omits remoteHost/remotePort for a dynamic forward', () => {
    const result = validatePortForwardConfig({ type: 'dynamic', localPort: 1080 });
    // A SOCKS proxy takes its destination from each client request, so a
    // fixed remote host on a dynamic forward is meaningless.
    expect(result.remoteHost).toBeUndefined();
    expect(result.remotePort).toBeUndefined();
  });

  // The gap that motivated this module: none of these were checked before, and
  // localPort went straight into server.listen().
  it.each([
    ['a non-object', 'not-an-object'],
    ['an array', []],
    ['an unknown type', { type: 'quantum', localPort: 80, remotePort: 80 }],
    ['a missing type', { localPort: 80, remotePort: 80 }],
    ['a string port', { type: 'local', localPort: '8080', remotePort: 80 }],
    ['a float port', { type: 'local', localPort: 80.5, remotePort: 80 }],
    ['port 0', { type: 'local', localPort: 0, remotePort: 80 }],
    ['port 65536', { type: 'local', localPort: 65536, remotePort: 80 }],
    ['a negative port', { type: 'local', localPort: -1, remotePort: 80 }],
    [
      'a null-byte bindAddress',
      { type: 'local', localPort: 80, bindAddress: 'a\0b', remotePort: 8 },
    ],
    ['a missing remotePort on a local forward', { type: 'local', localPort: 8080 }],
    ['an out-of-range remotePort', { type: 'local', localPort: 8080, remotePort: 70000 }],
  ])('rejects %s', (_label, input) => {
    expect(() => validatePortForwardConfig(input)).toThrow();
  });

  describe('public bind gate', () => {
    it.each(['local', 'dynamic'] as const)(
      'refuses a non-loopback bind for a %s forward by default',
      (type) => {
        expect(() =>
          validatePortForwardConfig({
            type,
            localPort: 8080,
            bindAddress: '0.0.0.0',
            remotePort: 80,
          }),
        ).toThrow(/expose the tunnel/i);
      },
    );

    it('reports FORBIDDEN, not a generic validation error', () => {
      try {
        validatePortForwardConfig({ ...localForward, bindAddress: '0.0.0.0' });
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe(ErrorCode.FORBIDDEN);
      }
    });

    it('allows a non-loopback bind when the user has opted in', () => {
      const result = validatePortForwardConfig(
        { ...localForward, bindAddress: '0.0.0.0' },
        { allowPublicBind: true },
      );
      expect(result.bindAddress).toBe('0.0.0.0');
    });

    it('does not gate remote forwards — the remote sshd governs its own exposure', () => {
      const result = validatePortForwardConfig({
        type: 'remote',
        localPort: 9090,
        bindAddress: '0.0.0.0',
        remoteHost: '127.0.0.1',
        remotePort: 3000,
      });
      expect(result.bindAddress).toBe('0.0.0.0');
    });
  });
});

describe('parseStoredPortForwards', () => {
  it('returns an empty list for null/empty input', () => {
    expect(parseStoredPortForwards(null)).toEqual([]);
    expect(parseStoredPortForwards('')).toEqual([]);
  });

  // Degrading rather than throwing matters here: this column is read on the
  // connect path, and a throw would prevent the SSH session entirely.
  it.each([
    ['malformed JSON', '{not json'],
    ['a JSON object instead of an array', '{"type":"local"}'],
    ['a JSON scalar', '42'],
  ])('returns an empty list for %s', (_label, input) => {
    expect(parseStoredPortForwards(input)).toEqual([]);
  });

  it('drops invalid entries but keeps the valid ones', () => {
    const json = JSON.stringify([
      localForward,
      { type: 'local', localPort: 'bogus' },
      { type: 'dynamic', localPort: 1080 },
      null,
    ]);
    const result = parseStoredPortForwards(json);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.localPort)).toEqual([8080, 1080]);
  });

  it('drops a stored public bind unless the user has opted in', () => {
    const json = JSON.stringify([{ ...localForward, bindAddress: '0.0.0.0' }]);
    expect(parseStoredPortForwards(json)).toHaveLength(0);
    expect(parseStoredPortForwards(json, { allowPublicBind: true })).toHaveLength(1);
  });
});
