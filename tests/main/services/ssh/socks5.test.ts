import { describe, expect, it } from 'vitest';
import {
  buildGreetingResponse,
  buildReply,
  MAX_HANDSHAKE_BYTES,
  parseGreeting,
  parseRequest,
  SOCKS_REPLY,
} from '../../../../src/main/services/ssh/socks5';

/**
 * The behaviour under test is specifically the one that used to crash the
 * whole main process: the previous implementation read fixed offsets straight
 * off whatever Buffer a single 'data' event delivered, so a truncated or
 * TCP-fragmented request threw a RangeError out of a socket handler →
 * uncaughtException → process.exit(1).
 *
 * Every case below therefore asserts two things: the result is correct, and
 * parsing did not throw.
 */

/** VER 5, one auth method (no-auth). */
const GREETING = Buffer.from([0x05, 0x01, 0x00]);

function ipv4Request(a: number, b: number, c: number, d: number, port: number): Buffer {
  const buf = Buffer.alloc(10);
  buf[0] = 0x05; // VER
  buf[1] = 0x01; // CONNECT
  buf[2] = 0x00; // RSV
  buf[3] = 0x01; // ATYP IPv4
  buf[4] = a;
  buf[5] = b;
  buf[6] = c;
  buf[7] = d;
  buf.writeUInt16BE(port, 8);
  return buf;
}

function domainRequest(host: string, port: number): Buffer {
  const hostBuf = Buffer.from(host, 'utf8');
  const buf = Buffer.alloc(5 + hostBuf.length + 2);
  buf[0] = 0x05;
  buf[1] = 0x01;
  buf[2] = 0x00;
  buf[3] = 0x03; // ATYP domain
  buf[4] = hostBuf.length;
  hostBuf.copy(buf, 5);
  buf.writeUInt16BE(port, 5 + hostBuf.length);
  return buf;
}

function ipv6Request(groups: number[], port: number): Buffer {
  const buf = Buffer.alloc(22);
  buf[0] = 0x05;
  buf[1] = 0x01;
  buf[2] = 0x00;
  buf[3] = 0x04; // ATYP IPv6
  for (let i = 0; i < 8; i++) buf.writeUInt16BE(groups[i]!, 4 + i * 2);
  buf.writeUInt16BE(port, 20);
  return buf;
}

describe('SOCKS5 greeting', () => {
  it('accepts a well-formed greeting and reports bytes consumed', () => {
    expect(parseGreeting(GREETING)).toEqual({ status: 'ok', consumed: 3 });
  });

  it('consumes only the greeting when request bytes are already appended', () => {
    const combined = Buffer.concat([GREETING, ipv4Request(1, 2, 3, 4, 80)]);
    const result = parseGreeting(combined);
    expect(result).toEqual({ status: 'ok', consumed: 3 });
  });

  it.each([
    ['zero bytes', Buffer.alloc(0)],
    ['version byte only', Buffer.from([0x05])],
    ['header without the advertised methods', Buffer.from([0x05, 0x03, 0x00])],
  ])('asks for more data on a partial greeting: %s', (_label, input) => {
    expect(parseGreeting(input)).toEqual({ status: 'need-more' });
  });

  it('rejects a non-SOCKS5 version', () => {
    const result = parseGreeting(Buffer.from([0x04, 0x01, 0x00]));
    expect(result.status).toBe('error');
  });

  it('rejects a greeting advertising zero auth methods', () => {
    const result = parseGreeting(Buffer.from([0x05, 0x00]));
    expect(result.status).toBe('error');
  });
});

describe('SOCKS5 request', () => {
  it('parses an IPv4 CONNECT', () => {
    expect(parseRequest(ipv4Request(93, 184, 216, 34, 443))).toEqual({
      status: 'ok',
      consumed: 10,
      host: '93.184.216.34',
      port: 443,
    });
  });

  it('parses a domain CONNECT', () => {
    expect(parseRequest(domainRequest('example.com', 8080))).toEqual({
      status: 'ok',
      consumed: 18,
      host: 'example.com',
      port: 8080,
    });
  });

  it('parses an IPv6 CONNECT', () => {
    const result = parseRequest(ipv6Request([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], 22));
    expect(result).toMatchObject({ status: 'ok', port: 22, consumed: 22 });
  });

  it('reports leftover bytes as unconsumed so they can be forwarded', () => {
    const payload = Buffer.from('GET / HTTP/1.1\r\n');
    const combined = Buffer.concat([ipv4Request(10, 0, 0, 1, 80), payload]);
    const result = parseRequest(combined);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(combined.subarray(result.consumed)).toEqual(payload);
  });

  // The regression that motivated this module. Each prefix of a valid request
  // must return need-more rather than throwing.
  it('never throws on any prefix of a valid request', () => {
    for (const full of [
      ipv4Request(1, 2, 3, 4, 80),
      domainRequest('example.com', 443),
      ipv6Request([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1], 22),
    ]) {
      for (let len = 0; len < full.length; len++) {
        const prefix = full.subarray(0, len);
        expect(() => parseRequest(prefix)).not.toThrow();
        expect(parseRequest(prefix)).toEqual({ status: 'need-more' });
      }
      // Only the complete buffer parses.
      expect(parseRequest(full).status).toBe('ok');
    }
  });

  it('never throws on a truncated domain request that lies about its length', () => {
    // Length byte claims 200 bytes of hostname; only 3 follow.
    const hostile = Buffer.from([0x05, 0x01, 0x00, 0x03, 200, 0x61, 0x62, 0x63]);
    expect(() => parseRequest(hostile)).not.toThrow();
    expect(parseRequest(hostile)).toEqual({ status: 'need-more' });
  });

  it('rejects a command other than CONNECT with the right reply code', () => {
    const bind = ipv4Request(1, 2, 3, 4, 80);
    bind[1] = 0x02; // BIND
    const result = parseRequest(bind);
    expect(result).toMatchObject({
      status: 'error',
      reply: SOCKS_REPLY.COMMAND_NOT_SUPPORTED,
    });
  });

  it('rejects an unknown address type', () => {
    const bad = ipv4Request(1, 2, 3, 4, 80);
    bad[3] = 0x09;
    expect(parseRequest(bad)).toMatchObject({
      status: 'error',
      reply: SOCKS_REPLY.ADDRESS_TYPE_NOT_SUPPORTED,
    });
  });

  it('rejects a zero-length domain', () => {
    const bad = Buffer.from([0x05, 0x01, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(parseRequest(bad)).toMatchObject({ status: 'error' });
  });

  it('rejects port 0', () => {
    expect(parseRequest(ipv4Request(1, 2, 3, 4, 0))).toMatchObject({ status: 'error' });
  });

  it('does not throw on arbitrary random input', () => {
    // Cheap fuzz: the parser is the boundary between an untrusted local client
    // and the main process, so "never throws" has to hold for garbage too.
    for (let i = 0; i < 500; i++) {
      const len = i % 40;
      const buf = Buffer.alloc(len);
      for (let j = 0; j < len; j++) buf[j] = (i * 31 + j * 17) % 256;
      expect(() => parseRequest(buf)).not.toThrow();
      expect(() => parseGreeting(buf)).not.toThrow();
    }
  });
});

describe('SOCKS5 responses', () => {
  it('offers no-authentication in the greeting response', () => {
    expect(Array.from(buildGreetingResponse())).toEqual([0x05, 0x00]);
  });

  it('builds a 10-byte reply with a zeroed IPv4 bind address', () => {
    const reply = buildReply(SOCKS_REPLY.SUCCEEDED);
    expect(reply).toHaveLength(10);
    expect(Array.from(reply)).toEqual([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
  });

  it('exposes a handshake cap small enough to bound buffering', () => {
    // A well-formed greeting is ≤257 bytes and a request ≤262; the cap must
    // sit above both but stay far below anything memory-relevant.
    expect(MAX_HANDSHAKE_BYTES).toBeGreaterThan(262);
    expect(MAX_HANDSHAKE_BYTES).toBeLessThanOrEqual(64 * 1024);
  });
});
