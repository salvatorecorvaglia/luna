import { ErrorCode, LunaError } from '@shared/errors';
import type { PortForwardingConfig } from '@shared/types/connection';
import log from '../../lib/logger';
import { assertBoundedInt, validationError } from '../../lib/validate';

/**
 * Validation for port-forward configs.
 *
 * These configs reach the SSH layer from two untrusted-ish directions:
 *  1. `ssh:start-port-forward` IPC, straight from the renderer, and
 *  2. the `port_forwards` JSON column, which a sync/import/manual sqlite edit
 *     can populate with anything.
 *
 * Neither path used to be checked at all, so a renderer could hand
 * `server.listen()` a non-integer port (throws) or bind a tunnel into the
 * user's private network on every interface via `bindAddress: '0.0.0.0'`
 * with no prompt. Everything else in this codebase validates ports through
 * `assertBoundedInt`; this module closes that gap.
 */

const VALID_TYPES = new Set<PortForwardingConfig['type']>(['local', 'remote', 'dynamic']);

/** Max length for a hostname field, per DNS limits. */
const MAX_HOST_LEN = 255;
/** Max length for the user-facing label. */
const MAX_NAME_LEN = 200;

/**
 * Hostnames/addresses that keep a listening socket on the local machine.
 * `local` and `dynamic` forwards bind here, so anything outside this set
 * exposes the tunnel to other hosts on the network.
 */
export function isLoopbackAddress(address: string): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  // Deliberately NOT accepting the name "localhost".
  //
  // `server.listen('localhost', …)` resolves the name through the OS resolver,
  // i.e. /etc/hosts. An entry mapping localhost to a routable address turns
  // what this function certified as a loopback bind into a public one, with no
  // warning and no opt-in. Only literal loopback addresses can be checked
  // without a resolver, so only those are accepted.
  if (normalized === '::1') return true;
  // 127.0.0.0/8 — anything in the loopback block, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

function assertHostField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`${name} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw validationError(`${name} must not contain null bytes`);
  }
  if (value.length > MAX_HOST_LEN) {
    throw validationError(`${name} must be at most ${MAX_HOST_LEN} characters`);
  }
  return value.trim();
}

export interface ValidatePortForwardOptions {
  /**
   * When false (the default), `local` and `dynamic` forwards may only bind a
   * loopback address. Mirrors OpenSSH's `GatewayPorts no`: a forward that
   * listens on 0.0.0.0 republishes a remote service to everyone on the LAN,
   * which should never happen by accident.
   */
  allowPublicBind?: boolean;
}

/**
 * Validate and normalise a port-forward config. Returns a new object with
 * defaults applied so callers never have to re-derive `bindAddress ?? '127.0.0.1'`
 * at each use site (the old code did that in six places, inconsistently).
 *
 * Throws `LunaError(VALIDATION_ERROR)` — or `FORBIDDEN` for a disallowed
 * public bind — so the renderer receives a structured, actionable code.
 */
export function validatePortForwardConfig(
  raw: unknown,
  options: ValidatePortForwardOptions = {},
): PortForwardingConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw validationError('port forward config must be an object');
  }
  const c = raw as Record<string, unknown>;

  if (typeof c.type !== 'string' || !VALID_TYPES.has(c.type as PortForwardingConfig['type'])) {
    throw validationError(
      `port forward type must be one of ${Array.from(VALID_TYPES).join('|')} (got ${JSON.stringify(c.type)})`,
    );
  }
  const type = c.type as PortForwardingConfig['type'];

  assertBoundedInt(c.localPort, 'localPort', 1, 65535);
  const localPort = c.localPort;

  // bindAddress is optional in practice — historic rows omit it entirely.
  const bindAddress =
    c.bindAddress == null ? '127.0.0.1' : assertHostField(c.bindAddress, 'bindAddress');

  // `local`/`dynamic` open a listening socket on *this* machine. `remote`
  // asks the SSH server to listen, where exposure is governed by the remote
  // sshd's own GatewayPorts setting — not ours to police.
  if ((type === 'local' || type === 'dynamic') && !isLoopbackAddress(bindAddress)) {
    if (!options.allowPublicBind) {
      throw new LunaError(
        `Refusing to bind ${type} forward to "${bindAddress}": this would expose the tunnel to other hosts on your network. ` +
          `Use a 127.0.0.x address, or enable "Allow public port-forward binds" in Settings.`,
        ErrorCode.FORBIDDEN,
        { reason: 'public-bind-refused', bindAddress, type },
      );
    }
    log.warn(
      `[SSH] ${type} port forward binding to non-loopback address ${bindAddress}:${localPort} — ` +
        `the tunnel is reachable from other hosts on this network.`,
    );
  }

  const out: PortForwardingConfig = {
    id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : '',
    type,
    bindAddress,
    localPort,
  };

  if (c.name != null) {
    if (typeof c.name !== 'string') throw validationError('port forward name must be a string');
    if (c.name.length > MAX_NAME_LEN) {
      throw validationError(`port forward name must be at most ${MAX_NAME_LEN} characters`);
    }
    out.name = c.name;
  }

  // A dynamic (SOCKS) forward has no fixed destination — the client supplies
  // one per connection — so remoteHost/remotePort are meaningless there.
  if (type !== 'dynamic') {
    out.remoteHost =
      c.remoteHost == null ? '127.0.0.1' : assertHostField(c.remoteHost, 'remoteHost');
    if (c.remotePort == null) {
      throw validationError(`remotePort is required for a ${type} port forward`);
    }
    assertBoundedInt(c.remotePort, 'remotePort', 1, 65535);
    out.remotePort = c.remotePort;
  }

  return out;
}

/**
 * Parse and validate the `port_forwards` JSON column.
 *
 * Never throws: a malformed or partially-invalid column must not prevent the
 * SSH session from connecting. Bad entries are dropped with a log line, which
 * is strictly better than the previous behaviour where a non-array or a
 * garbage entry either silently no-op'd or blew up inside `server.listen`.
 */
export function parseStoredPortForwards(
  json: string | null | undefined,
  options: ValidatePortForwardOptions = {},
): PortForwardingConfig[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    log.error('[SSH] Failed to parse port_forwards JSON; ignoring:', err);
    return [];
  }
  if (!Array.isArray(parsed)) {
    log.warn('[SSH] port_forwards column was not an array; ignoring');
    return [];
  }
  const out: PortForwardingConfig[] = [];
  for (const entry of parsed) {
    try {
      out.push(validatePortForwardConfig(entry, options));
    } catch (err) {
      log.warn(
        `[SSH] Dropping invalid stored port forward: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}
