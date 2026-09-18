/**
 * Incremental SOCKS5 (RFC 1928) request parser.
 *
 * Split out of the dynamic port-forward handler as a pure function so it can
 * be unit-tested against fragmented and malformed input. The previous inline
 * implementation read fixed offsets directly off whatever `Buffer` a single
 * `'data'` event happened to deliver:
 *
 *   const port = chunk.readUInt16BE(offset);
 *
 * TCP does not guarantee message framing, so a client whose greeting and
 * request land in separate segments — or a hostile client sending a 2-byte
 * request — made `readUInt16BE` throw a RangeError from inside a socket
 * event handler. That escapes as an uncaughtException and takes the whole
 * main process down with it, killing every SSH session and transfer.
 *
 * Every function here is total: it returns a discriminated result and never
 * throws, so the caller can decide between "wait for more bytes", "reply with
 * a SOCKS error code", and "drop the connection".
 */

/** SOCKS protocol version we speak. */
export const SOCKS_VERSION = 0x05;

/** CONNECT is the only command Luna proxies — no BIND, no UDP ASSOCIATE. */
const CMD_CONNECT = 0x01;

const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

/** Reply codes from RFC 1928 §6 that we actually emit. */
export const SOCKS_REPLY = {
  SUCCEEDED: 0x00,
  GENERAL_FAILURE: 0x01,
  HOST_UNREACHABLE: 0x04,
  COMMAND_NOT_SUPPORTED: 0x07,
  ADDRESS_TYPE_NOT_SUPPORTED: 0x08,
} as const;

/**
 * Upper bound on buffered handshake bytes before we give up on a client.
 * A well-formed greeting is at most 257 bytes and a request at most 262;
 * anything past 4 KiB is a client that will never produce a valid request,
 * and buffering it indefinitely is a memory-growth vector.
 */
export const MAX_HANDSHAKE_BYTES = 4096;

export type GreetingResult =
  | { status: 'need-more' }
  | { status: 'ok'; consumed: number }
  | { status: 'error'; reason: string };

export type RequestResult =
  | { status: 'need-more' }
  | { status: 'ok'; consumed: number; host: string; port: number }
  | { status: 'error'; reason: string; reply: number };

/**
 * Parse the client greeting: VER | NMETHODS | METHODS[NMETHODS].
 *
 * Luna only offers "no authentication" (the proxy is bound to loopback and
 * inherits the SSH session's authority), so the method list is validated for
 * length but its contents are not inspected.
 */
export function parseGreeting(buf: Buffer): GreetingResult {
  if (buf.length < 2) return { status: 'need-more' };
  // Non-null throughout: the length check above guarantees indices 0-1 exist.
  const version = buf[0]!;
  if (version !== SOCKS_VERSION) {
    return { status: 'error', reason: `unsupported SOCKS version 0x${version.toString(16)}` };
  }
  const nMethods = buf[1]!;
  if (nMethods === 0) {
    return { status: 'error', reason: 'greeting advertised zero auth methods' };
  }
  const needed = 2 + nMethods;
  if (buf.length < needed) return { status: 'need-more' };
  return { status: 'ok', consumed: needed };
}

/**
 * Parse a CONNECT request: VER | CMD | RSV | ATYP | DST.ADDR | DST.PORT.
 *
 * Returns `need-more` whenever the buffer is a strict prefix of a
 * well-formed request, so the caller can accumulate across segments instead
 * of indexing past the end.
 */
export function parseRequest(buf: Buffer): RequestResult {
  // VER + CMD + RSV + ATYP
  if (buf.length < 4) return { status: 'need-more' };
  // Non-null: the length check above guarantees indices 0-3 exist.
  const version = buf[0]!;
  if (version !== SOCKS_VERSION) {
    return {
      status: 'error',
      reason: `unsupported SOCKS version 0x${version.toString(16)}`,
      reply: SOCKS_REPLY.GENERAL_FAILURE,
    };
  }
  const cmd = buf[1]!;
  if (cmd !== CMD_CONNECT) {
    return {
      status: 'error',
      reason: `unsupported SOCKS command 0x${cmd.toString(16)} (only CONNECT is proxied)`,
      reply: SOCKS_REPLY.COMMAND_NOT_SUPPORTED,
    };
  }

  const atyp = buf[3]!;
  let host: string;
  let addrEnd: number;

  if (atyp === ATYP_IPV4) {
    addrEnd = 4 + 4;
    if (buf.length < addrEnd + 2) return { status: 'need-more' };
    // Non-null: the length check above guarantees indices 4-7 exist.
    host = `${buf[4]!}.${buf[5]!}.${buf[6]!}.${buf[7]!}`;
  } else if (atyp === ATYP_DOMAIN) {
    // Length byte itself may not have arrived yet.
    if (buf.length < 5) return { status: 'need-more' };
    const len = buf[4]!;
    if (len === 0) {
      return {
        status: 'error',
        reason: 'domain address had zero length',
        reply: SOCKS_REPLY.ADDRESS_TYPE_NOT_SUPPORTED,
      };
    }
    addrEnd = 5 + len;
    if (buf.length < addrEnd + 2) return { status: 'need-more' };
    host = buf.toString('utf8', 5, addrEnd);
  } else if (atyp === ATYP_IPV6) {
    addrEnd = 4 + 16;
    if (buf.length < addrEnd + 2) return { status: 'need-more' };
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(buf.readUInt16BE(4 + i).toString(16));
    }
    host = groups.join(':');
  } else {
    return {
      status: 'error',
      reason: `unsupported address type 0x${atyp.toString(16)}`,
      reply: SOCKS_REPLY.ADDRESS_TYPE_NOT_SUPPORTED,
    };
  }

  const port = buf.readUInt16BE(addrEnd);
  if (port === 0) {
    return {
      status: 'error',
      reason: 'destination port was zero',
      reply: SOCKS_REPLY.GENERAL_FAILURE,
    };
  }

  return { status: 'ok', consumed: addrEnd + 2, host, port };
}

/** Server method-selection response: "version 5, no authentication required". */
export function buildGreetingResponse(): Buffer {
  return Buffer.from([SOCKS_VERSION, 0x00]);
}

/**
 * Build a reply frame. Luna always reports a zeroed IPv4 bind address —
 * clients that matter (curl, browsers, ssh -o ProxyCommand) ignore it, and
 * echoing the real forwarded-out address would leak internal topology.
 */
export function buildReply(code: number): Buffer {
  return Buffer.from([SOCKS_VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
}
