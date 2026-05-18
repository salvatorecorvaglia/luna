import { readFile, stat } from 'fs/promises';
import type { Duplex } from 'stream';
import { utils, type ConnectConfig, type CipherAlgorithm } from 'ssh2';
import type { AuthType } from '@shared/types/connection';
import { IPC } from '@shared/constants';
import { emitToRenderer } from '../emit';
import { fingerprintKey, getStoredHostKey, verifyHostKey } from '../host-key-store';
import { getSetting } from '../database';
import { retrieveCredential } from '../credential-store';
import { expandAndValidatePrivateKeyPath } from '../../lib/validate';
import { getCiphers } from 'crypto';
import log from '../../lib/logger';
import { parseHostKeyAlgorithm, type PendingHostKeyRegistry } from './host-key-flow';

/**
 * Defense-in-depth cap on credential length. The IPC layer rejects secrets
 * longer than MAX_SECRET_LEN before they ever reach this module, but a
 * compromised credential store entry, a migration bug, or a future direct
 * caller could still hand us an oversized blob — fed to ssh2's key parser
 * or sent on the wire to a peer, that's a cheap DoS surface. 4 KiB
 * comfortably exceeds any legitimate passphrase or password.
 */
const MAX_SECRET_BYTES = 4096;

function assertSecretLength(value: string | null | undefined, label: string): void {
  if (
    value !== undefined &&
    value !== null &&
    Buffer.byteLength(value, 'utf-8') > MAX_SECRET_BYTES
  ) {
    throw new Error(`${label} exceeds ${MAX_SECRET_BYTES}-byte limit`);
  }
}

/**
 * Filter a list of SSH algorithms against what the current Node.js crypto
 * implementation actually supports. Prevents "Unsupported algorithm" errors
 * when a modern primitive (like chacha20-poly1305) is missing from the
 * underlying OpenSSL build.
 */
function filterSupportedCiphers(requested: CipherAlgorithm[]): CipherAlgorithm[] {
  const supported = new Set(getCiphers());
  return requested.filter((c) => {
    // Map SSH cipher names to OpenSSL names used by Node's crypto.getCiphers()
    if (c === 'chacha20-poly1305@openssh.com') return supported.has('chacha20-poly1305');
    if (c === 'aes128-gcm@openssh.com') return supported.has('aes-128-gcm');
    if (c === 'aes256-gcm@openssh.com') return supported.has('aes-256-gcm');
    if (c === 'aes128-ctr') return supported.has('aes-128-ctr');
    if (c === 'aes192-ctr') return supported.has('aes-192-ctr');
    if (c === 'aes256-ctr') return supported.has('aes-256-ctr');
    return true;
  });
}

export interface ConnectParams {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string | null;
  password?: string;
  passphrase?: string;
}

export interface BuildConfigOptions {
  /** Registry that captures candidate keys awaiting user trust. */
  pendingHostKeys: PendingHostKeyRegistry;
  /** Stable id for the connection row, used for emit metadata + credential lookup. */
  connectionId?: string;
  /** Stable id for the open session, used for emit metadata. */
  sessionId?: string;
  /**
   * Optional already-established Duplex (e.g. a `forwardOut` channel from a
   * jump host's SSH client). When provided, ssh2 uses this stream as the
   * underlying socket instead of opening a TCP connection — implements
   * single-hop ProxyJump.
   */
  sock?: Duplex;
}

/**
 * Build an ssh2 `ConnectConfig` from raw user input + the host-key trust
 * machinery. Pulled out of `SshManager` so `connect()` and `testConnection()`
 * share the same auth + verifier logic without sharing private state.
 *
 * Returns `{config}` on success, or `{config, error}` if private-key read
 * failed — the partial `config` is returned so callers can still introspect
 * what was attempted.
 */
/**
 * Tiny LRU for parsed private-key buffers, keyed by `path|mtimeMs|size`.
 * Re-reading and parsing a key on every connect was noticeable on rapid
 * reconnect storms; mtime+size form a cheap freshness signal so an edited
 * key file invalidates automatically.
 */
const KEY_CACHE_MAX = 8;
const keyCache = new Map<string, Buffer>();
/**
 * In-flight read dedup. Two concurrent connects against the same key file
 * (common on rapid reconnect bursts and parallel SFTP/SSH sessions) would
 * otherwise both miss the cache, both stat+read the file, and both write
 * the result back — wasting disk I/O and widening the window during which
 * private key material lives on the heap unnecessarily. The map holds the
 * pending promise so concurrent callers join the same read.
 */
const keyReadInFlight = new Map<string, Promise<Buffer>>();

async function loadPrivateKeyCached(absPath: string): Promise<Buffer> {
  const st = await stat(absPath);
  const key = `${absPath}|${st.mtimeMs}|${st.size}`;
  const hit = keyCache.get(key);
  if (hit) {
    // Refresh recency: Map iteration order is insertion order, so re-set
    // moves the entry to the MRU end of the eviction queue.
    keyCache.delete(key);
    keyCache.set(key, hit);
    return hit;
  }

  // If a read for the same composite key is already in flight, await its
  // result instead of issuing a duplicate.
  const pending = keyReadInFlight.get(key);
  if (pending) return pending;

  const readPromise = (async (): Promise<Buffer> => {
    const buf = await readFile(absPath);
    keyCache.set(key, buf);
    while (keyCache.size > KEY_CACHE_MAX) {
      const oldest = keyCache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = keyCache.get(oldest);
      keyCache.delete(oldest);
      // Best-effort scrub: zero the buffer contents so private key material
      // doesn't linger in the V8 heap longer than necessary.
      if (evicted) evicted.fill(0);
    }
    return buf;
  })().finally(() => {
    // Equality check guards against a stale entry left behind by an
    // overlapping eviction-then-reinsertion sequence.
    if (keyReadInFlight.get(key) === readPromise) keyReadInFlight.delete(key);
  });
  keyReadInFlight.set(key, readPromise);
  return readPromise;
}

export async function buildConnectConfig(
  params: ConnectParams,
  opts: BuildConfigOptions,
): Promise<{ config: ConnectConfig; error?: string }> {
  const { pendingHostKeys, connectionId, sessionId, sock } = opts;

  const config: ConnectConfig = {
    host: params.host,
    port: params.port,
    // When a tunneled socket is supplied, ssh2 still validates the *target*
    // host key via `hostVerifier` below — the channel is transparent. The
    // bastion's host key was validated when its own client connected.
    ...(sock ? { sock } : {}),
    username: params.username,
    keepaliveInterval: getSetting('ssh.keepAliveInterval', 10000),
    keepaliveCountMax: 3,
    readyTimeout: getSetting('ssh.readyTimeout', 30000),
    // Restrict negotiation to modern primitives. ssh2's defaults still include
    // some legacy options (e.g. sha1 HMACs, diffie-hellman-group14-sha1).
    // Reject those at the protocol layer so a misconfigured server can't
    // downgrade us. Order is the offered preference.
    algorithms: {
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group16-sha512',
        'diffie-hellman-group18-sha512',
      ],
      cipher: filterSupportedCiphers([
        'chacha20-poly1305@openssh.com',
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
      ]),
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
      ],
      hmac: [
        'hmac-sha2-256-etm@openssh.com',
        'hmac-sha2-512-etm@openssh.com',
        'hmac-sha2-256',
        'hmac-sha2-512',
      ],
      compress: ['none', 'zlib@openssh.com'],
    },
    hostVerifier: (key: Buffer) => {
      const algorithm = parseHostKeyAlgorithm(key);
      const result = verifyHostKey(params.host, params.port, key, algorithm);
      if (result.weakAlgorithm) {
        // Don't prompt the user — refusing weak algorithms is a hard policy.
        // Log to the audit trail so a series of weak-algo rejections is
        // diagnosable (server misconfig vs MITM downgrade attempt).
        log.warn(
          `[host-key] refused weak algorithm "${algorithm}" for ${params.host}:${params.port} (fingerprint ${fingerprintKey(key)})`,
        );
        emitToRenderer(IPC.SSH_ON_ERROR, {
          sessionId: sessionId ?? '',
          error: `Refusing weak host-key algorithm "${algorithm}". The server should be reconfigured to advertise ed25519, ecdsa, or rsa-sha2-* host keys.`,
        });
        return false;
      }
      if (!result.trusted) {
        const stored = getStoredHostKey(params.host, params.port);
        // Audit trail: log every rejection with the fingerprint + algorithm.
        // A "changed" event is what an MITM downgrade looks like in practice,
        // so it's the most important signal to capture for forensics.
        log.warn(
          `[host-key] verification failed for ${params.host}:${params.port} ` +
            `(algorithm=${algorithm}, fingerprint=${fingerprintKey(key)}, ` +
            `stored=${stored?.fingerprint ?? 'none'}, isFirst=${result.isFirst})`,
        );
        pendingHostKeys.remember(params.host, params.port, key, algorithm);
        emitToRenderer(IPC.SSH_ON_HOST_KEY_CHANGE, {
          sessionId: sessionId ?? '',
          connectionId: connectionId ?? '',
          host: params.host,
          port: params.port,
          storedFingerprint: stored?.fingerprint ?? '',
          newFingerprint: fingerprintKey(key),
          algorithm,
          isFirst: result.isFirst,
        });
        const reason = result.isFirst
          ? `Unknown host ${params.host}:${params.port}. Verify the ${algorithm} fingerprint before trusting.`
          : `Host key for ${params.host}:${params.port} has changed. Confirm the new fingerprint before reconnecting.`;
        emitToRenderer(IPC.SSH_ON_ERROR, { sessionId: sessionId ?? '', error: reason });
      }
      return result.trusted;
    },
  };

  // If a transient password/passphrase was supplied (test-connection on
  // unsaved settings), use it directly. Otherwise look up the saved
  // credential by connectionId, but only for the active authType.
  const password =
    params.authType === 'password'
      ? (params.password ?? (connectionId ? retrieveCredential(connectionId) : undefined))
      : undefined;
  const passphrase =
    params.authType === 'key+passphrase'
      ? (params.passphrase ?? (connectionId ? retrieveCredential(connectionId) : undefined))
      : undefined;

  // Defense-in-depth length check: the IPC layer caps incoming secrets, but
  // saved credentials, future call sites, or a corrupted store could still
  // surface oversized values.
  try {
    assertSecretLength(password, 'SSH password');
    assertSecretLength(passphrase, 'SSH key passphrase');
  } catch (err) {
    return { config, error: err instanceof Error ? err.message : String(err) };
  }

  if (params.authType === 'password') {
    config.password = password || undefined;
    return { config };
  }

  if (params.authType === 'key' || params.authType === 'key+passphrase') {
    if (!params.privateKeyPath) {
      return { config, error: 'Private key path not configured' };
    }
    try {
      // Expand ~ via os.homedir() (not $HOME, which can be unset/empty and
      // collapse "~/.." into "/.."), and confine the real (symlink-resolved)
      // target to the home directory.
      const keyPath = await expandAndValidatePrivateKeyPath(params.privateKeyPath, 'privateKeyPath');
      const keyBuf = await loadPrivateKeyCached(keyPath);
      const parsedKey = utils.parseKey(keyBuf, passphrase || undefined);

      if (parsedKey instanceof Error) {
        log.warn(`[SSH] Failed to parse private key: ${parsedKey.message}`);
        // If it's a PuTTY key and we got an unsupported format error, it might
        // be an encrypted key where the user didn't provide a passphrase, or
        // a version we truly don't support.
        if (
          parsedKey.message.includes('Unsupported key format') &&
          keyBuf.toString('utf-8').includes('PuTTY-User-Key-File')
        ) {
          return {
            config,
            error:
              'Unsupported or encrypted PuTTY key. If the key is encrypted, please use "Key + Passphrase" mode.',
          };
        }
        return { config, error: `Invalid private key: ${parsedKey.message}` };
      }

      config.privateKey = parsedKey.getPrivatePEM();
    } catch (err: unknown) {
      // Log underlying details, but surface only a generic message — fs
      // error strings include the absolute key path which we never want
      // to leak across IPC.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      log.warn(`[SSH] Failed to read private key (${code ?? 'unknown'})`);
      const message = err instanceof Error ? err.message : '';
      const reason =
        code === 'ENOENT'
          ? 'Private key file not found'
          : code === 'EACCES'
            ? 'Permission denied reading private key'
            : message.includes('home directory')
              ? 'Private key path must be inside the home directory'
              : 'Failed to read private key';
      return { config, error: reason };
    }
  }

  return { config };
}
